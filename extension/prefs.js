import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

export default function () {
    const settings = new Gio.Settings({
        schema_id: "org.gnome.shell.extensions.cpuquiet"
    });

    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: "Thermal Control" });

    function slider(title, key, min, max) {
        const adj = new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: 1
        });
        const scale = new Gtk.Scale({ adjustment: adj });
        scale.set_value(settings.get_int(key));
        scale.connect("value-changed", s => {
            settings.set_int(key, s.get_value());
        });
        return new Adw.ActionRow({ title, child: scale });
    }

    group.add(slider("Min MHz", "min-freq", 800000, 4000000));
    group.add(slider("Throttle Start (°C)", "throttle-start", 40, 90));
    group.add(slider("Max Temp (°C)", "max-temp", 50, 100));

    page.add(group);
    return page;
}