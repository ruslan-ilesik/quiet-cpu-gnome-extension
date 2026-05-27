import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

const DBUS_NAME = 'org.lesikr.cpuquiet';
const DBUS_OBJECT = '/org/cpuquiet';
const DBUS_INTERFACE = 'org.lesikr.cpuquiet';
const SCHEMA_ID = 'org.gnome.shell.extensions.cpuquiet';

function getHardwareMaxFreq() {
    try {
        const file = Gio.File.new_for_path('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq');
        const [ok, contents] = file.load_contents(null);
        if (ok) {
            const khz = parseInt(contents.toString().trim(), 10);
            if (!isNaN(khz)) return khz;
        }
    } catch (e) {
        log('Failed to read cpuinfo_max_freq: ' + e.message);
    }
    return 4000000;
}

const HARDWARE_MAX_KHZ = getHardwareMaxFreq();
const HARDWARE_MAX_MHZ = Math.round(HARDWARE_MAX_KHZ / 1000);

const PARAMS = [
    {
        key: 'min-freq',
        title: 'Min frequency',
        unit: 'MHz',
        min: 800,
        max: HARDWARE_MAX_MHZ,
        step: 100,
        toUi: v => Math.round(v / 1000),
        toSetting: v => v * 1000,
    },
    {
        key: 'throttle-start',
        title: 'Throttle start',
        unit: '°C',
        min: 40,
        max: 90,
        step: 1,
        toUi: v => v,
        toSetting: v => v,
    },
    {
        key: 'max-temp',
        title: 'Max temperature',
        unit: '°C',
        min: 50,
        max: 100,
        step: 1,
        toUi: v => v,
        toSetting: v => v,
    },
];

let indicator = null;
let proxy = null;
let settings = null;
let timer = null;
let panelIcon = null;
let panelLabel = null;
let headerLabel = null;
let toggle = null;
let rowWidgets = new Map();
let updatingUI = false;
let settingsSignalIds = [];
let currentAllowedMax = 0;

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function roundToStep(v, step) {
    return Math.round(v / step) * step;
}

function syncDaemonConfig() {
    if (!proxy || !settings) return;
    try {
        proxy.call_sync(
            'SetConfig',
            new GLib.Variant('(iiii)', [
                settings.get_int('min-freq'),
                0,
                settings.get_int('throttle-start'),
                settings.get_int('max-temp'),
            ]),
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );
    } catch (e) {
        log('SetConfig failed: ' + e.message);
    }
}

function setPanelText(temp, freq, enabled) {
    const curMHz = Math.round(freq / 1000);
    const maxMHz = Math.round(currentAllowedMax / 1000);
    const text = `${temp}°C · ${curMHz} MHz / ${maxMHz} MHz`;
    if (panelLabel) panelLabel.set_text(text);
    if (headerLabel) headerLabel.set_text(text);
    if (panelIcon) {
        panelIcon.icon_name = enabled ? 'cpu-symbolic' : 'process-stop-symbolic';
        panelIcon.icon_size = 16;
    }
}

function updateRow(spec) {
    if (!settings || !rowWidgets.has(spec.key)) return;
    const w = rowWidgets.get(spec.key);
    const raw = settings.get_int(spec.key);
    const ui = spec.toUi(raw);
    const norm = (ui - spec.min) / (spec.max - spec.min);
    updatingUI = true;
    w.slider.value = norm;
    w.entry.clutter_text.text = `${ui}`;
    updatingUI = false;
}

function refreshAll() {
    for (const s of PARAMS) updateRow(s);
    syncDaemonConfig();
}

function commit(spec, uiValue, fromEntry = false) {
    let value = clamp(roundToStep(uiValue, spec.step), spec.min, spec.max);
    updatingUI = true;
    settings.set_int(spec.key, spec.toSetting(value));
    const w = rowWidgets.get(spec.key);
    if (w) {
        w.slider.value = (value - spec.min) / (spec.max - spec.min);
        if (!fromEntry) {
            w.entry.clutter_text.text = `${value}`;
        }
    }
    updatingUI = false;
    syncDaemonConfig();
}

function fetchMaxFreq() {
    if (!proxy) return;
    try {
        const res = proxy.call_sync('GetMaxFreq', null, Gio.DBusCallFlags.NONE, -1, null);
        const maxkHz = res.deepUnpack()[0];
        currentAllowedMax = (maxkHz > 0) ? maxkHz : HARDWARE_MAX_KHZ;
    } catch (e) {
        log('GetMaxFreq error: ' + e.message);
        currentAllowedMax = HARDWARE_MAX_KHZ;
    }
}

function createHeader() {
    const row = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    const box = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'padding: 12px 14px; spacing: 6px;',
    });
    const title = new St.Label({
        text: 'CPU Quiet',
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        style: 'font-weight: bold; font-size: 1.05em; color: white;',
    });
    headerLabel = new St.Label({
        text: `--°C · -- MHz / -- MHz`,
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        style: 'opacity: 0.85; color: white;',
    });
    box.add_child(title);
    box.add_child(headerLabel);
    row.add_child(box);
    return row;
}

function createRow(spec) {
    const row = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
    const hbox = new St.BoxLayout({
        x_expand: true,
        style: 'spacing: 10px; padding: 2px 6px;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const title = new St.Label({
        text: spec.title,
        style: 'min-width: 140px; color: white;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const slider = new Slider.Slider(0);
    slider.x_expand = true;
    const entry = new St.Entry({
        text: '',
        can_focus: true,
        x_expand: false,
        style: 'min-width: 92px; text-align: right; color: white; background-color: rgba(0,0,0,0.5); border-radius: 4px;',
    });
    const unit = new St.Label({
        text: spec.unit,
        opacity: 0.8,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'color: white;',
    });

    let hasFocus = false;

    const applyEntry = () => {
        let v = Number.parseFloat(entry.clutter_text.text);
        if (isNaN(v)) {
            updateRow(spec);
            return;
        }
        v = clamp(v, spec.min, spec.max);
        v = roundToStep(v, spec.step);
        commit(spec, v, true);
    };

    slider.connect('notify::value', () => {
        if (updatingUI) return;
        const ui = spec.min + (spec.max - spec.min) * slider.value;
        const rounded = roundToStep(ui, spec.step);
        updatingUI = true;
        entry.clutter_text.text = `${rounded}`;
        updatingUI = false;
        commit(spec, rounded, false);
    });

    entry.clutter_text.connect('activate', applyEntry);
    entry.connect('notify::has-focus', () => {
        const focused = entry.has_focus;
        if (hasFocus && !focused) {
            applyEntry();
        }
        hasFocus = focused;
    });

    hbox.add_child(title);
    hbox.add_child(slider);
    hbox.add_child(entry);
    hbox.add_child(unit);
    row.add_child(hbox);
    rowWidgets.set(spec.key, { slider, entry });
    return row;
}

function update() {
    if (!proxy) {
        setPanelText(0, 0, false);
        return;
    }
    try {
        fetchMaxFreq();
        const res = proxy.call_sync('GetStatus', null, Gio.DBusCallFlags.NONE, -1, null);
        const [temp, freq, enabled] = res.deepUnpack();
        setPanelText(temp, freq, enabled);
        if (toggle) toggle.setToggleState(enabled);
    } catch (e) {
        setPanelText(0, 0, false);
        log('Update error: ' + e.message);
    }
}

function onToggle(item) {
    if (!proxy) return;
    try {
        proxy.call_sync(
            'SetEnabled',
            new GLib.Variant('(b)', [item.state]),
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );
    } catch (e) {
        log('SetEnabled failed: ' + e.message);
    }
}

function initProxy() {
    try {
        proxy = Gio.DBusProxy.new_sync(
            Gio.DBus.system,
            Gio.DBusProxyFlags.NONE,
            null,
            DBUS_NAME,
            DBUS_OBJECT,
            DBUS_INTERFACE,
            null
        );
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            refreshAll();
            update();
            return false;
        });
    } catch (e) {
        log('D-Bus proxy failed: ' + e.message);
        proxy = null;
    }
}

function clearSignals() {
    if (!settings) return;
    for (const id of settingsSignalIds) {
        try { settings.disconnect(id); } catch (_) {}
    }
    settingsSignalIds = [];
}

export default class Extension {
    enable() {
        settings = new Gio.Settings({ schema_id: SCHEMA_ID });
        for (const k of ['min-freq', 'throttle-start', 'max-temp']) {
            settingsSignalIds.push(
                settings.connect(`changed::${k}`, refreshAll)
            );
        }
        initProxy();

        indicator = new PanelMenu.Button(0.0, 'CPU Quiet');
        const panelBox = new St.BoxLayout({
            style: 'spacing: 6px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelIcon = new St.Icon({
            icon_name: 'cpu-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
            icon_size: 16,
        });
        panelLabel = new St.Label({
            text: `--°C · -- MHz / -- MHz`,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: white;',
        });
        panelBox.add_child(panelIcon);
        panelBox.add_child(panelLabel);
        indicator.add_child(panelBox);
        indicator.menu.box.style = 'min-width: 560px;';
        indicator.menu.addMenuItem(createHeader());
        indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const s of PARAMS)
            indicator.menu.addMenuItem(createRow(s));
        toggle = new PopupMenu.PopupSwitchMenuItem('Quiet Mode', false);
        toggle.connect('toggled', onToggle);
        indicator.menu.addMenuItem(toggle);
        Main.panel.addToStatusArea('cpuquiet', indicator);
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            update();
            return true;
        });
    }

    disable() {
        if (timer) GLib.source_remove(timer);
        timer = null;
        clearSignals();
        if (indicator) indicator.destroy();
        indicator = null;
        proxy = null;
        settings = null;
        panelIcon = null;
        panelLabel = null;
        headerLabel = null;
        rowWidgets.clear();
        updatingUI = false;
    }
}