// Railway-Infrastruktur als Code (ersetzt railway.toml). Variablen und Secrets bleiben im Railway-Dashboard
// (variables: managed false). Vor jedem `railway config apply` zuerst `railway config plan` ansehen.
// Das Upload-Volume am Backend (/app/uploads) hält Artikelbilder, Belegscans und Werbung über Deploys hinweg.
import { database, defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // Image fest eintragen: der Kurzbefehl postgres() würde auf das aktuelle Standard-Image (andere Hauptversion) wechseln,
  // und eine Datenbank lässt sich nicht einfach auf eine andere Hauptversion umhängen.
  const Postgres = database("Postgres", "postgres", { image: "ghcr.io/railwayapp-templates/postgres-ssl:17", region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const backendVolume = volume("backend-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 500 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 500 });
  const frontend = service("frontend", {
    source: github("limo29/clubtouch3", { branch: "main", checkSuites: false, rootDirectory: "/apps/frontend" }),
    build: { builder: "DOCKERFILE" },
    replicas: { "europe-west4-drams3a": 1 },
  });
  const backend = service("backend", {
    source: github("limo29/clubtouch3", { branch: "main", checkSuites: false, rootDirectory: "/apps/backend" }),
    build: { builder: "DOCKERFILE" },
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/app/uploads": backendVolume },
  });

  return project("Clubtouch 3.0", {
    variables: { managed: false },
    resources: [frontend, backend, Postgres, backendVolume, postgresVolume],
  });
});
