import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { createCommandEnvelope } from "@mikejhill/portable-document-core";
import {
  FirebaseDocumentStore,
  FirebaseRuntime,
  type FirebasePrincipal,
} from "@mikejhill/portable-document-firebase";
import type { FirebaseApp } from "firebase/app";
import { definition, initialState } from "./fixture";

const PROJECT_ID = "portable-document-kit-test";
const BOARD_ID = "document-123";
const OWNER_ID = "owner-user";
const EDITOR_ID = "editor-user";
const VIEWER_ID = "viewer-user";

describe("Firestore Security Rules", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: "127.0.0.1",
        port: 8180,
        rules: await readFile("packages/firebase/rules/firestore.rules", "utf8"),
      },
    });
  });

  afterEach(async () => environment.clearFirestore());
  afterAll(async () => environment.cleanup());

  it("allows the verified owner to create a valid document", async () => {
    const owner = verifiedContext(environment, OWNER_ID);
    await assertSucceeds(setDoc(documentRef(modularFirestore(owner)), validDocument(OWNER_ID, false)));
  });

  it("rejects anonymous ownership and malformed envelopes", async () => {
    const anonymous = anonymousContext(environment, "anonymous-owner");
    await assertFails(setDoc(documentRef(modularFirestore(anonymous)), validDocument("anonymous-owner", false)));

    const owner = verifiedContext(environment, OWNER_ID);
    await assertFails(setDoc(documentRef(modularFirestore(owner)), {
      ...validDocument(OWNER_ID, false),
      revision: 0,
    }));
  });

  it("limits private reads and catalog queries to members", async () => {
    await seedDocument(environment);
    const viewer = verifiedContext(environment, VIEWER_ID);
    const outsider = verifiedContext(environment, "outsider-user");

    await assertSucceeds(getDoc(documentRef(modularFirestore(viewer))));
    await assertFails(getDoc(documentRef(modularFirestore(outsider))));
    await assertSucceeds(getDocs(query(
      collection(modularFirestore(viewer), "pdkDocuments"),
      where("memberIds", "array-contains", VIEWER_ID),
    )));
    await assertFails(getDocs(collection(modularFirestore(outsider), "pdkDocuments")));
  });

  it("allows editors to commit one monotonic envelope update", async () => {
    await seedDocument(environment);
    const editor = modularFirestore(verifiedContext(environment, EDITOR_ID));

    await assertSucceeds(updateDoc(documentRef(editor), validContentUpdate(2, EDITOR_ID)));
    await assertFails(updateDoc(documentRef(editor), validContentUpdate(4, EDITOR_ID)));
    await assertFails(updateDoc(documentRef(editor), { ownerId: EDITOR_ID }));
  });

  it("allows only owners to manage membership and ownership", async () => {
    await seedDocument(environment);
    const editor = modularFirestore(verifiedContext(environment, EDITOR_ID));
    const owner = modularFirestore(verifiedContext(environment, OWNER_ID));

    await assertFails(updateDoc(documentRef(editor), {
      memberIds: [OWNER_ID, EDITOR_ID, VIEWER_ID, "new-user"],
      roles: { [OWNER_ID]: "owner", [EDITOR_ID]: "editor", [VIEWER_ID]: "viewer", "new-user": "editor" },
      updatedAt: 2,
      updatedBy: EDITOR_ID,
    }));
    await assertSucceeds(updateDoc(documentRef(owner), {
      memberIds: [OWNER_ID, EDITOR_ID, VIEWER_ID, "new-user"],
      roles: { [OWNER_ID]: "owner", [EDITOR_ID]: "editor", [VIEWER_ID]: "viewer", "new-user": "editor" },
      updatedAt: 2,
      updatedBy: OWNER_ID,
    }));
    await assertSucceeds(updateDoc(documentRef(owner), {
      ownerId: EDITOR_ID,
      roles: { [OWNER_ID]: "editor", [EDITOR_ID]: "owner", [VIEWER_ID]: "viewer", "new-user": "editor" },
      updatedAt: 3,
      updatedBy: OWNER_ID,
    }));
  });

  it("supports revocable anonymous editor sessions without listable publications", async () => {
    await seedDocument(environment);
    const owner = modularFirestore(verifiedContext(environment, OWNER_ID));
    const token = "editor-token-123456";
    await publishEditorToken(owner, token);

    const guestId = "anonymous-guest";
    const guest = modularFirestore(anonymousContext(environment, guestId));
    await assertSucceeds(setDoc(
      doc(guest, "pdkDocuments", BOARD_ID, "editorSessions", guestId),
      { schemaVersion: 1, token, principalId: guestId, createdAt: 1 },
    ));
    await assertSucceeds(getDoc(documentRef(guest)));
    await assertSucceeds(updateDoc(documentRef(guest), validContentUpdate(2, guestId)));
    await assertFails(getDocs(collection(guest, "pdkPublications")));

    await assertSucceeds(deleteDoc(doc(owner, "pdkPublications", token)));
    await assertFails(getDoc(documentRef(guest)));
  });

  it("keeps public snapshots readable by token but impossible to enumerate", async () => {
    await seedDocument(environment);
    const owner = modularFirestore(verifiedContext(environment, OWNER_ID));
    const token = "view-token-123456";
    await publishToken(owner, token, "view");

    const unauthenticated = modularFirestore(environment.unauthenticatedContext());
    await assertSucceeds(getDoc(doc(unauthenticated, "pdkPublications", token)));
    await assertFails(getDocs(collection(unauthenticated, "pdkPublications")));
  });

  it("executes the Firebase document adapter lifecycle against enforced rules", async () => {
    const ownerDatabase = modularFirestore(verifiedContext(environment, OWNER_ID));
    const ownerStore = firebaseStore(ownerDatabase, {
      id: OWNER_ID,
      anonymous: false,
      verified: true,
    });

    const created = await ownerStore.create(BOARD_ID, initialState);
    if (created.revision !== 1) throw new Error("Create did not return revision 1.");
    if ((await ownerStore.list()).length !== 1) throw new Error("Catalog did not include the created document.");

    const committed = await ownerStore.commit(createCommandEnvelope({
      id: "adapter-command-1",
      documentId: BOARD_ID,
      documentType: definition.type,
      baseRevision: 1,
      issuedAt: 2,
      command: { type: "set", id: "b", value: "B" } as const,
    }), "Add Item");
    if (!committed.ok || committed.snapshot.revision !== 2) throw new Error("Command commit failed.");
    if ((await ownerStore.listCheckpoints(BOARD_ID)).length !== 2) throw new Error("Checkpoint was not written.");

    const publication = await ownerStore.publish(BOARD_ID, "view");
    const publicStore = firebaseStore(modularFirestore(environment.unauthenticatedContext()), null);
    const resolved = await publicStore.resolve(publication.token);
    if (!resolved || resolved.snapshot.revision !== 2) throw new Error("Public publication did not resolve.");

    await ownerStore.revoke(BOARD_ID, "view");
    if (await publicStore.resolve(publication.token)) throw new Error("Revoked publication still resolved.");
  });

  it("executes anonymous invitation, guest commit, rotation, and revocation through the adapter", async () => {
    const ownerStore = firebaseStore(modularFirestore(verifiedContext(environment, OWNER_ID)), {
      id: OWNER_ID,
      anonymous: false,
      verified: true,
    });
    await ownerStore.create(BOARD_ID, initialState);
    const invitation = await ownerStore.publish(BOARD_ID, "editor");

    const guestId = "adapter-anonymous-guest";
    const guestStore = firebaseStore(modularFirestore(anonymousContext(environment, guestId)), {
      id: guestId,
      anonymous: true,
      verified: false,
    });
    if (await guestStore.acceptEditorInvitation(invitation.token) !== BOARD_ID) {
      throw new Error("Invitation resolved to the wrong document.");
    }
    if (!(await guestStore.load(BOARD_ID))) throw new Error("Guest could not load the invited document.");

    const committed = await guestStore.commit(createCommandEnvelope({
      id: "guest-command-1",
      documentId: BOARD_ID,
      documentType: definition.type,
      baseRevision: 1,
      issuedAt: 2,
      actorId: guestId,
      command: { type: "title", value: "Guest Edit" } as const,
    }));
    if (!committed.ok) throw new Error("Guest commit failed.");

    await ownerStore.publish(BOARD_ID, "editor", true);
    await assertFails(getDoc(documentRef(modularFirestore(anonymousContext(environment, guestId)))));
  });

  it("executes replace, subscription, history, presence, and owner deletion through the adapter", async () => {
    const ownerDatabase = modularFirestore(verifiedContext(environment, OWNER_ID));
    const ownerStore = firebaseStore(ownerDatabase, {
      id: OWNER_ID,
      anonymous: false,
      verified: true,
      displayName: "Owner",
    });
    await ownerStore.create(BOARD_ID, initialState);

    const subscribed = new Promise<number>((resolve) => {
      let unsubscribe: () => void = () => undefined;
      unsubscribe = ownerStore.subscribe(BOARD_ID, (snapshot) => {
        if (snapshot.revision === 2) {
          unsubscribe();
          resolve(snapshot.revision);
        }
      });
    });
    await ownerStore.replace(BOARD_ID, { ...initialState, title: "Replaced" }, 1);
    if (await subscribed !== 2) throw new Error("Subscription did not receive revision 2.");
    if ((await ownerStore.restore(BOARD_ID, 1)).reason !== "Document Created") {
      throw new Error("Baseline checkpoint did not restore.");
    }

    const presenceSeen = new Promise<void>((resolve) => {
      let unsubscribe: () => void = () => undefined;
      unsubscribe = ownerStore.subscribePresence(BOARD_ID, (entries) => {
        if (entries.some((entry) => entry.sessionId === "owner-session")) {
          unsubscribe();
          resolve();
        }
      });
    });
    await ownerStore.heartbeat(BOARD_ID, {
      principalId: OWNER_ID,
      sessionId: "owner-session",
      displayName: "Owner",
      lastSeen: 1_000,
    });
    await presenceSeen;
    await ownerStore.clear(BOARD_ID, "owner-session");

    await ownerStore.delete(BOARD_ID);
    if (await ownerStore.load(BOARD_ID)) throw new Error("Deleted document still loaded.");
  });

  it("executes membership changes and ownership transfer through provider methods", async () => {
    const ownerStore = firebaseStore(modularFirestore(verifiedContext(environment, OWNER_ID)), {
      id: OWNER_ID,
      anonymous: false,
      verified: true,
    });
    await ownerStore.create(BOARD_ID, initialState);
    await ownerStore.setMember(BOARD_ID, { principalId: EDITOR_ID, role: "editor" });
    await ownerStore.setMember(BOARD_ID, { principalId: VIEWER_ID, role: "viewer" });
    if ((await ownerStore.listMembers(BOARD_ID)).length !== 3) throw new Error("Members were not stored.");
    await ownerStore.transferOwnership(BOARD_ID, EDITOR_ID);

    const newOwnerStore = firebaseStore(modularFirestore(verifiedContext(environment, EDITOR_ID)), {
      id: EDITOR_ID,
      anonymous: false,
      verified: true,
    });
    await newOwnerStore.removeMember(BOARD_ID, VIEWER_ID);
    const members = await newOwnerStore.listMembers(BOARD_ID);
    if (members.some((member) => member.principalId === VIEWER_ID)) {
      throw new Error("Removed viewer remained a member.");
    }
  });

  it("merges independent stale commands and reports same-target conflicts through the adapter", async () => {
    const store = firebaseStore(modularFirestore(verifiedContext(environment, OWNER_ID)), {
      id: OWNER_ID,
      anonymous: false,
      verified: true,
    });
    await store.create(BOARD_ID, initialState);
    const command = (id: string, baseRevision: number, value: string) => createCommandEnvelope({
      id,
      documentId: BOARD_ID,
      documentType: definition.type,
      baseRevision,
      command: { type: "title" as const, value },
    });
    expectCommit(await store.commit(command("remote-title", 1, "Remote")), true);
    const independent = createCommandEnvelope({
      id: "independent-item",
      documentId: BOARD_ID,
      documentType: definition.type,
      baseRevision: 1,
      command: { type: "set" as const, id: "b", value: "B" },
    });
    expectCommit(await store.commit(independent), true);
    const conflict = await store.commit(createCommandEnvelope({
      id: "same-item",
      documentId: BOARD_ID,
      documentType: definition.type,
      baseRevision: 2,
      command: { type: "set" as const, id: "b", value: "Local" },
    }));
    if (conflict.ok || conflict.failure.code !== "conflict") throw new Error("Same-target conflict was not reported.");
  });
});

function expectCommit(result: { readonly ok: boolean }, expected: boolean): void {
  if (result.ok !== expected) throw new Error(`Expected commit ok=${expected}.`);
}

function verifiedContext(environment: RulesTestEnvironment, userId: string): RulesTestContext {
  return environment.authenticatedContext(userId, {
    email: `${userId}@example.test`,
    email_verified: true,
  });
}

function anonymousContext(environment: RulesTestEnvironment, userId: string): RulesTestContext {
  return environment.authenticatedContext(userId, {
    email_verified: false,
    firebase: { sign_in_provider: "anonymous" },
  });
}

/** Converts the rules harness compat wrapper at the test-only SDK boundary. */
function modularFirestore(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

function documentRef(database: Firestore) {
  return doc(database, "pdkDocuments", BOARD_ID);
}

function validDocument(ownerId = OWNER_ID, includeCollaborators = true) {
  return {
    schemaVersion: 1,
    documentType: "test.document",
    documentSchemaVersion: 1,
    state: { title: "Test", items: {} },
    summary: { title: "Test", count: 0 },
    ownerId,
    memberIds: ownerId === OWNER_ID && includeCollaborators ? [OWNER_ID, EDITOR_ID, VIEWER_ID] : [ownerId],
    roles: ownerId === OWNER_ID && includeCollaborators
      ? { [OWNER_ID]: "owner", [EDITOR_ID]: "editor", [VIEWER_ID]: "viewer" }
      : { [ownerId]: "owner" },
    revision: 1,
    recentCommandIds: [],
    checkpointRevisions: [1],
    publicationTokens: {},
    lastTargets: [],
    createdAt: 1,
    updatedAt: 1,
    updatedBy: ownerId,
  };
}

function validContentUpdate(revision: number, updatedBy: string) {
  return {
    state: { title: `Revision ${revision}`, items: {} },
    summary: { title: `Revision ${revision}`, count: 0 },
    documentSchemaVersion: 1,
    revision,
    recentCommandIds: [`command-${revision}`],
    checkpointRevisions: [1],
    lastTargets: ["title"],
    updatedAt: revision,
    updatedBy,
  };
}

async function seedDocument(environment: RulesTestEnvironment): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(documentRef(modularFirestore(context)), validDocument());
  });
}

async function publishEditorToken(database: Firestore, token: string): Promise<void> {
  return publishToken(database, token, "editor");
}

async function publishToken(database: Firestore, token: string, kind: "view" | "editor"): Promise<void> {
  const batch = writeBatch(database);
  batch.update(documentRef(database), {
    publicationTokens: { [kind]: token },
    updatedAt: 2,
    updatedBy: OWNER_ID,
  });
  batch.set(doc(database, "pdkPublications", token), {
    schemaVersion: 1,
    documentId: BOARD_ID,
    kind,
    revision: 1,
    documentType: "test.document",
    documentSchemaVersion: 1,
    state: { title: "Test", items: {} },
    summary: { title: "Test", count: 0 },
    createdAt: 2,
    updatedAt: 2,
  });
  await assertSucceeds(batch.commit());
}

function firebaseStore(database: Firestore, principal: FirebasePrincipal | null) {
  const runtime = new FirebaseRuntime({
    app: {} as FirebaseApp,
    getAuth: () => {
      throw new Error("Authentication is not used by repository integration tests.");
    },
    getFirestore: () => database,
  });
  return new FirebaseDocumentStore(runtime, definition, {
    getPrincipal: () => principal,
    createToken: (() => {
      let sequence = 0;
      return () => `adapter-token-${++sequence}-123456`;
    })(),
    now: () => 1_000,
  });
}
