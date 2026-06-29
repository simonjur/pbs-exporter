/* global Vue, Vuetify */
// PBS Exporter status UI — Vue 3 (global build) + Vuetify 3 (browser build).
// No bundler/build step: this file is served as-is and uses the global
// `Vue` and `Vuetify` UMD builds vendored from node_modules.

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;
const { createVuetify } = Vuetify;

const REFRESH_MS = 15000;

const App = {
  setup() {
    const exporter = ref({ version: "", commit: "", buildTime: "" });
    const summary = ref({ total: 0, up: 0, down: 0, pending: 0 });
    const targets = ref([]);
    const loading = ref(true);
    const error = ref("");
    const lastUpdated = ref(0);
    // Ticks every second so relative timestamps stay fresh without refetching.
    const now = ref(Date.now());

    async function load() {
      try {
        const resp = await fetch("/api/status");
        if (!resp.ok) {throw new Error(`HTTP ${resp.status}`);}
        const data = await resp.json();
        exporter.value = data.exporter;
        summary.value = data.summary;
        targets.value = data.targets;
        lastUpdated.value = Date.now();
        error.value = "";
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
      } finally {
        loading.value = false;
      }
    }

    function relativeTime(ms) {
      if (!ms) {return "never";}
      const secs = Math.max(0, Math.round((now.value - ms) / 1000));
      if (secs < 60) {return `${secs}s ago`;}
      if (secs < 3600) {return `${Math.floor(secs / 60)}m ago`;}
      if (secs < 86400) {return `${Math.floor(secs / 3600)}h ago`;}
      return `${Math.floor(secs / 86400)}d ago`;
    }

    function absoluteTime(ms) {
      return ms ? new Date(ms).toLocaleString() : "—";
    }

    function statusColor(up) {
      if (up === true) {return "success";}
      if (up === false) {return "error";}
      return "grey";
    }

    function statusLabel(up) {
      if (up === true) {return "UP";}
      if (up === false) {return "DOWN";}
      return "PENDING";
    }

    let dataTimer;
    let clockTimer;
    onMounted(() => {
      load();
      dataTimer = setInterval(load, REFRESH_MS);
      clockTimer = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    });
    onUnmounted(() => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    });

    const hasPending = computed(() => summary.value.pending > 0);

    return {
      exporter,
      summary,
      targets,
      loading,
      error,
      lastUpdated,
      hasPending,
      load,
      relativeTime,
      absoluteTime,
      statusColor,
      statusLabel,
    };
  },
  template: `
<v-app>
  <v-app-bar color="indigo-darken-3" density="comfortable" flat>
    <v-app-bar-title>Proxmox Backup Server Exporter</v-app-bar-title>
    <template #append>
      <span class="text-caption mr-4 d-none d-sm-inline">{{ exporter.version }}</span>
      <v-btn variant="text" :loading="loading" @click="load">Refresh</v-btn>
    </template>
  </v-app-bar>

  <v-main class="bg-grey-lighten-4">
    <v-container>
      <v-alert v-if="error" type="error" :icon="false" variant="tonal" class="mb-4">
        Failed to load status: {{ error }}
      </v-alert>

      <v-row class="mb-2">
        <v-col cols="6" sm="3">
          <v-card variant="tonal">
            <v-card-text class="text-center">
              <div class="text-h4">{{ summary.total }}</div>
              <div class="text-caption text-medium-emphasis">Targets</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="success">
            <v-card-text class="text-center">
              <div class="text-h4">{{ summary.up }}</div>
              <div class="text-caption">Up</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3">
          <v-card variant="tonal" color="error">
            <v-card-text class="text-center">
              <div class="text-h4">{{ summary.down }}</div>
              <div class="text-caption">Down</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="6" sm="3" v-if="hasPending">
          <v-card variant="tonal" color="grey">
            <v-card-text class="text-center">
              <div class="text-h4">{{ summary.pending }}</div>
              <div class="text-caption">Pending</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card>
        <v-table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Target</th>
              <th>Version</th>
              <th>Last scrape</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="targets.length === 0">
              <td colspan="5" class="text-center text-medium-emphasis py-6">
                No targets scraped yet.
              </td>
            </tr>
            <tr v-for="t in targets" :key="t.target">
              <td>
                <v-chip :color="statusColor(t.up)" size="small" label>
                  {{ statusLabel(t.up) }}
                </v-chip>
              </td>
              <td class="text-body-2">{{ t.target }}</td>
              <td>
                <span v-if="t.up && t.version">{{ t.version }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
              <td>
                <span :title="absoluteTime(t.lastScrapeMs)">{{ relativeTime(t.lastScrapeMs) }}</span>
              </td>
              <td>
                <span v-if="t.up === false" class="text-error text-body-2">{{ t.error }}</span>
                <span v-else-if="t.up && t.release" class="text-medium-emphasis text-body-2">release {{ t.release }}</span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <div class="text-caption text-medium-emphasis mt-4">
        <a href="/metrics">/metrics</a> &middot;
        exporter {{ exporter.version }} (commit {{ exporter.commit }}) &middot;
        updated {{ relativeTime(lastUpdated) }}
      </div>
    </v-container>
  </v-main>
</v-app>`,
};

createApp(App)
  .use(createVuetify({ theme: { defaultTheme: "light" } }))
  .mount("#app");
