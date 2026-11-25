// Mémoire des projets : une petite base du navigateur (IndexedDB).
// Un enregistrement par projet, images et vidéos comprises (gardées en fichiers, pas en adresses) :
// { id, name, created, updated, slides: [item], aside: [item], notes: { clé: texte } }
// item : { type: "img" | "video", name, blob } | { type: "web", url, label }
const DB = (() => {
  let ready;
  const open = () => ready ||= new Promise((res, rej) => {
    const r = indexedDB.open("slides-projects", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("projects", mode);
      const q = fn(t.objectStore("projects"));
      t.oncomplete = () => res(q.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => run("readonly", (s) => s.getAll()),
    get: (id) => run("readonly", (s) => s.get(id)),
    put: (p) => run("readwrite", (s) => s.put(p)),
    del: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
