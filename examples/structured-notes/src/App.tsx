import { useEffect, useMemo, useState } from "react";
import { applyDocumentCommand } from "@mikejhill/portable-document-core";
import { createPortableUrl } from "@mikejhill/portable-document-browser";
import { PortableSnapshotCodec } from "@mikejhill/portable-document-codec";
import { IndexedDbDocumentStore } from "@mikejhill/portable-document-indexeddb";
import { initialNotebook, notebookDefinition, type Notebook, type NotebookCommand, type NoteNode } from "./model";

export function App() {
  const codec = useMemo(() => new PortableSnapshotCodec({ prefix: "#pdn1:", definition: notebookDefinition }), []);
  const deviceStore = useMemo(() => new IndexedDbDocumentStore(notebookDefinition, { databaseName: "portable-notes" }), []);
  const restored = useMemo(() => codec.decode(window.location.hash), [codec]);
  const [notebook, setNotebook] = useState<Notebook>(restored.ok ? restored.state : initialNotebook);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const match = /^#pdnl1:([A-Za-z0-9_-]{8,128})$/.exec(window.location.hash);
    if (match?.[1]) {
      void deviceStore.load(match[1]).then((snapshot) => {
        if (snapshot) setNotebook(snapshot.state);
        else setMessage("Device note not found");
      }).catch(() => setMessage("Device storage unavailable"));
    }
    return () => deviceStore.close();
  }, [deviceStore]);

  const dispatch = (command: NotebookCommand) => {
    const result = applyDocumentCommand(notebookDefinition, notebook, command);
    if (!result.ok) {
      setMessage(result.failure.code);
      return;
    }
    setNotebook(result.state);
    history.replaceState(null, "", codec.encode(result.state));
    setMessage("Saved in this URL");
  };

  const addRoot = (kind: NoteNode["kind"]) => {
    const id = crypto.randomUUID();
    const node: NoteNode = kind === "section"
      ? { id, kind, title: "New Section", childIds: [] }
      : kind === "text"
        ? { id, kind, text: "New text" }
        : { id, kind, label: "Field", value: "Value" };
    dispatch({ type: "add-node", node, parentId: null });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(createPortableUrl(codec, notebook, window.location.href));
    setMessage("Portable link copied");
  };

  const saveOnDevice = async () => {
    const existing = await deviceStore.load(notebook.id);
    const saved = existing
      ? await deviceStore.replace(notebook.id, notebook, existing.revision)
      : await deviceStore.create(notebook.id, notebook);
    history.pushState({ revision: saved.revision }, "", `#pdnl1:${notebook.id}`);
    setMessage(`Saved on this device — revision ${saved.revision}`);
  };

  const viewHistory = async () => {
    const checkpoints = await deviceStore.listCheckpoints(notebook.id);
    setMessage(checkpoints.length ? checkpoints.map((checkpoint) => `${checkpoint.revision}: ${checkpoint.reason}`).join(" · ") : "No saved history");
  };

  return <main>
    <header>
      <input aria-label="Notebook title" value={notebook.title} onChange={(event) => dispatch({ type: "set-title", title: event.target.value })} />
      <button onClick={copy}>Copy Portable Link</button>
      <button onClick={() => void saveOnDevice()}>Save On Device</button>
    </header>
    <nav>
      <button onClick={() => addRoot("section")}>Add Section</button>
      <button onClick={() => addRoot("text")}>Add Text</button>
      <button onClick={() => addRoot("field")}>Add Field</button>
      <button onClick={() => void viewHistory()}>Version History</button>
    </nav>
    <p role="status">{message}</p>
    <section className="notes">
      {notebook.rootIds.map((id, index) => <NodeView key={id} id={id} parentId={null} index={index} notebook={notebook} dispatch={dispatch} />)}
    </section>
  </main>;
}

function NodeView({ id, parentId, index, notebook, dispatch }: { id: string; parentId: string | null; index: number; notebook: Notebook; dispatch: (command: NotebookCommand) => void }) {
  const node = notebook.nodes[id];
  if (!node) return null;
  const siblings = parentId === null ? notebook.rootIds : (notebook.nodes[parentId]?.kind === "section" ? notebook.nodes[parentId].childIds : []);
  const firstSection = Object.values(notebook.nodes).find(
    (candidate): candidate is Extract<NoteNode, { kind: "section" }> => candidate.kind === "section" && candidate.id !== id,
  );
  return <article className={`node ${node.kind}`}>
    {node.kind === "section" && <>
      <input value={node.title} onChange={(event) => dispatch({ type: "update-node", nodeId: id, patch: { title: event.target.value } })} />
      <div className="children">{node.childIds.map((child, childIndex) => <NodeView key={child} id={child} parentId={id} index={childIndex} notebook={notebook} dispatch={dispatch} />)}</div>
    </>}
    {node.kind === "text" && <textarea value={node.text} onChange={(event) => dispatch({ type: "update-node", nodeId: id, patch: { text: event.target.value } })} />}
    {node.kind === "field" && <label><input value={node.label} onChange={(event) => dispatch({ type: "update-node", nodeId: id, patch: { label: event.target.value } })} /><input value={node.value} onChange={(event) => dispatch({ type: "update-node", nodeId: id, patch: { value: event.target.value } })} /></label>}
    <div className="node-actions">
      <button disabled={index === 0} onClick={() => dispatch({ type: "move-node", nodeId: id, parentId, index: index - 1 })}>Move Up</button>
      <button disabled={index === siblings.length - 1} onClick={() => dispatch({ type: "move-node", nodeId: id, parentId, index: index + 1 })}>Move Down</button>
      {parentId !== null && <button onClick={() => dispatch({ type: "move-node", nodeId: id, parentId: null, index: notebook.rootIds.length })}>Move To Root</button>}
      {firstSection && <button onClick={() => dispatch({ type: "move-node", nodeId: id, parentId: firstSection.id, index: firstSection.childIds.length })}>Move Into {firstSection.title}</button>}
      <button className="delete" onClick={() => dispatch({ type: "delete-node", nodeId: id })}>Delete</button>
    </div>
  </article>;
}
