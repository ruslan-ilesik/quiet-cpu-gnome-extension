#include <gio/gio.h>
#include <glib.h>
#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <unistd.h>
#include <algorithm>

// -------------------------------------------------------------
// Configuration structure and persistent storage
// -------------------------------------------------------------
struct Config {
    int min_freq = 800000;
    int max_freq = 0;        // 0 means "use hardware max"
    int throttle_start = 50; // °C
    int max_temp = 70;       // °C
    bool enabled = false;
} cfg;

static const char *CONFIG_FILE = "/etc/cpu-quiet.conf";

void save_config() {
    GKeyFile *keyfile = g_key_file_new();
    g_key_file_set_integer(keyfile, "CPU", "min_freq", cfg.min_freq);
    g_key_file_set_integer(keyfile, "CPU", "max_freq", cfg.max_freq);
    g_key_file_set_integer(keyfile, "CPU", "throttle_start", cfg.throttle_start);
    g_key_file_set_integer(keyfile, "CPU", "max_temp", cfg.max_temp);
    g_key_file_set_boolean(keyfile, "CPU", "enabled", cfg.enabled);

    gsize data_len;
    gchar *data = g_key_file_to_data(keyfile, &data_len, NULL);
    if (data) {
        g_file_set_contents(CONFIG_FILE, data, data_len, NULL);
        g_free(data);
    }
    g_key_file_free(keyfile);
}

void load_config() {
    GKeyFile *keyfile = g_key_file_new();
    if (g_key_file_load_from_file(keyfile, CONFIG_FILE, G_KEY_FILE_NONE, NULL)) {
        cfg.min_freq = g_key_file_get_integer(keyfile, "CPU", "min_freq", NULL);
        cfg.max_freq = g_key_file_get_integer(keyfile, "CPU", "max_freq", NULL);
        cfg.throttle_start = g_key_file_get_integer(keyfile, "CPU", "throttle_start", NULL);
        cfg.max_temp = g_key_file_get_integer(keyfile, "CPU", "max_temp", NULL);
        cfg.enabled = g_key_file_get_boolean(keyfile, "CPU", "enabled", NULL);
    }
    g_key_file_free(keyfile);
}

// -------------------------------------------------------------
// Hardware access functions – CPU temperature only
// -------------------------------------------------------------
int read_temp() {
    std::string cpu_hwmon_path;
    // Look for known CPU temperature sensors
    for (auto &p : std::filesystem::directory_iterator("/sys/class/hwmon/")) {
        std::ifstream name_file(p.path().string() + "/name");
        std::string name;
        if (name_file) {
            std::getline(name_file, name);
            if (name == "coretemp" || name == "k10temp" || name == "cpu_thermal") {
                cpu_hwmon_path = p.path().string();
                break;
            }
        }
    }
    // If no CPU-specific sensor found, fallback to first hwmon (but log warning)
    if (cpu_hwmon_path.empty()) {
        g_warning("No CPU temperature sensor found, using first available hwmon");
        for (auto &p : std::filesystem::directory_iterator("/sys/class/hwmon/")) {
            cpu_hwmon_path = p.path().string();
            break;
        }
    }
    if (!cpu_hwmon_path.empty()) {
        std::ifstream f(cpu_hwmon_path + "/temp1_input");
        int t;
        if (f) { f >> t; return t / 1000; }
    }
    g_warning("Could not read temperature, using 40°C fallback");
    return 40;
}

int read_freq() {
    std::ifstream f("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq");
    int v = 0;
    if (f) f >> v;
    return v;
}

int cpu_max_freq() {
    std::ifstream f("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq");
    int v = 3000000;
    if (f) f >> v;
    return v;
}

void set_freq(int freq) {
    long num_cpus = sysconf(_SC_NPROCESSORS_ONLN);
    if (num_cpus <= 0) num_cpus = 32;
    for (long i = 0; i < num_cpus; ++i) {
        std::ofstream o("/sys/devices/system/cpu/cpu" + std::to_string(i) +
                        "/cpufreq/scaling_max_freq");
        if (o) o << freq;
    }
}

void restore_default_freq() {
    int default_max = cpu_max_freq();
    set_freq(default_max);
    g_print("Restored default max frequency: %d kHz\n", default_max);
}

int compute(int temp) {
    int maxf = (cfg.max_freq == 0) ? cpu_max_freq() : cfg.max_freq;
    if (temp < cfg.throttle_start) return maxf;
    if (temp >= cfg.max_temp) return cfg.min_freq;
    float r = float(temp - cfg.throttle_start) /
              float(cfg.max_temp - cfg.throttle_start);
    r = r * r;
    return maxf - int(r * (maxf - cfg.min_freq));
}

// -------------------------------------------------------------
// GDBus method handlers
// -------------------------------------------------------------
static void handle_set_enabled(GDBusMethodInvocation *invocation,
                               GVariant *parameters,
                               gpointer user_data) {
    gboolean enabled;
    g_variant_get(parameters, "(b)", &enabled);
    bool was_enabled = cfg.enabled;
    cfg.enabled = enabled;
    save_config();

    if (!enabled && was_enabled != enabled) {
        restore_default_freq();
    } else if (enabled && !was_enabled) {
        g_print("Throttling enabled\n");
    }
    g_dbus_method_invocation_return_value(invocation, NULL);
}

static void handle_set_config(GDBusMethodInvocation *invocation,
                              GVariant *parameters,
                              gpointer user_data) {
    gint minf, maxf, start, maxT;
    g_variant_get(parameters, "(iiii)", &minf, &maxf, &start, &maxT);
    cfg.min_freq = minf;
    cfg.max_freq = maxf;
    cfg.throttle_start = start;
    cfg.max_temp = maxT;
    save_config();
    g_dbus_method_invocation_return_value(invocation, NULL);
}

static void handle_get_status(GDBusMethodInvocation *invocation,
                              GVariant *parameters,
                              gpointer user_data) {
    gint temp = read_temp();
    gint freq = read_freq();
    gboolean enabled = cfg.enabled;
    gint minf = cfg.min_freq;
    GVariant *result = g_variant_new("(iibi)", temp, freq, enabled, minf);
    g_dbus_method_invocation_return_value(invocation, result);
}

static void handle_get_max_freq(GDBusMethodInvocation *invocation,
                                GVariant *parameters,
                                gpointer user_data) {
    std::ifstream f("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq");
    int maxf = 0;
    if (f) f >> maxf;
    GVariant *result = g_variant_new("(i)", maxf);
    g_dbus_method_invocation_return_value(invocation, result);
}

// -------------------------------------------------------------
// Main
// -------------------------------------------------------------
int main() {
    load_config();

    if (cfg.enabled) {
        int initial_freq = compute(read_temp());
        set_freq(initial_freq);
        g_print("Daemon starting with throttling enabled, initial freq = %d kHz\n", initial_freq);
    } else {
        restore_default_freq();
    }

    GMainLoop *loop = g_main_loop_new(NULL, FALSE);
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, NULL);
    if (!bus) {
        g_printerr("Failed to connect to system bus\n");
        return 1;
    }

   // In the introspection XML, add the new method:
static const char introspection_xml[] =
    "<node>"
    "  <interface name='org.lesikr.cpuquiet'>"
    "    <method name='SetEnabled'>"
    "      <arg type='b' name='enabled' direction='in'/>"
    "    </method>"
    "    <method name='SetConfig'>"
    "      <arg type='i' name='min_freq' direction='in'/>"
    "      <arg type='i' name='max_freq' direction='in'/>"
    "      <arg type='i' name='throttle_start' direction='in'/>"
    "      <arg type='i' name='max_temp' direction='in'/>"
    "    </method>"
    "    <method name='GetStatus'>"
    "      <arg type='i' name='temperature' direction='out'/>"
    "      <arg type='i' name='current_freq' direction='out'/>"
    "      <arg type='b' name='enabled' direction='out'/>"
    "      <arg type='i' name='min_freq' direction='out'/>"
    "    </method>"
    "    <method name='GetMaxFreq'>"          // <-- ADD THIS
    "      <arg type='i' name='max_freq' direction='out'/>"
    "    </method>"
    "  </interface>"
    "</node>";

// In the vtable, add the new method dispatch:
static const GDBusInterfaceVTable interface_vtable = {
    .method_call = [](GDBusConnection *connection,
                      const gchar *sender,
                      const gchar *object_path,
                      const gchar *interface_name,
                      const gchar *method_name,
                      GVariant *parameters,
                      GDBusMethodInvocation *invocation,
                      gpointer user_data) {
        if (g_strcmp0(method_name, "SetEnabled") == 0)
            handle_set_enabled(invocation, parameters, user_data);
        else if (g_strcmp0(method_name, "SetConfig") == 0)
            handle_set_config(invocation, parameters, user_data);
        else if (g_strcmp0(method_name, "GetStatus") == 0)
            handle_get_status(invocation, parameters, user_data);
        else if (g_strcmp0(method_name, "GetMaxFreq") == 0)   // <-- ADD THIS
            handle_get_max_freq(invocation, parameters, user_data);
        else
            g_dbus_method_invocation_return_error(invocation,
                G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD,
                "Unknown method %s", method_name);
    }
};

    GError *error = NULL;
    guint registration_id = g_dbus_connection_register_object(
        bus,
        "/org/cpuquiet",
        g_dbus_node_info_new_for_xml(introspection_xml, NULL)->interfaces[0],
        &interface_vtable,
        NULL, NULL, &error);
    if (registration_id == 0) {
        g_printerr("Failed to register D-Bus object: %s\n", error->message);
        g_error_free(error);
        return 1;
    }

    guint name_id = g_bus_own_name_on_connection(
        bus,
        "org.lesikr.cpuquiet",
        G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT,
        NULL, NULL, NULL, NULL);
    if (name_id == 0) {
        g_printerr("Failed to request service name\n");
        return 1;
    }

    g_print("Daemon started successfully (CPU temperature sensor detected)\n");

    std::thread([loop]() {
        int last = -1;
        while (true) {
            if (!cfg.enabled) {
                std::this_thread::sleep_for(std::chrono::seconds(5));
                continue;
            }
            int temp = read_temp();
            int freq = compute(temp);
            if (std::abs(freq - last) > 50000) {
                set_freq(freq);
                last = freq;
            }
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
    }).detach();

    g_main_loop_run(loop);

    g_dbus_connection_unregister_object(bus, registration_id);
    g_object_unref(bus);
    return 0;
}