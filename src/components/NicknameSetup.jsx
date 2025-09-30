import { useEffect, useState } from "react";
import { auth, db } from "../firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";

const NICK_REGEX = /^[A-Za-z0-9_\.\-]{3,20}$/;

export default function NicknameSetup({ onDone }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nick, setNick] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        // Check if user already has a profile
        const userRef = doc(db, "users", u.uid);
        const snap = await getDoc(userRef);
        if (snap.exists() && snap.data()?.nickname) {
          setLoading(false);
          onDone?.();
        } else {
          setLoading(false);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Error reading profile:", e);
        setError("Could not check profile. Review Firestore rules.");
        setLoading(false);
      }
    });
    return () => unsub();
  }, [onDone]);

  async function handleSave() {
    setError("");
    const trimmed = nick.trim();
    if (!NICK_REGEX.test(trimmed)) {
      setError("Nickname must be 3-20 characters (letters, numbers, _ . -)");
      return;
    }
    setSaving(true);
    try {
      const normalized = trimmed.toLowerCase();
      const nickRef = doc(db, "nicknames", normalized);
      const userRef = doc(db, "users", user.uid);

      await runTransaction(db, async (tx) => {
        const nickDoc = await tx.get(nickRef);
        if (nickDoc.exists()) {
          throw new Error("That nickname is already in use");
        }
        tx.set(nickRef, { uid: user.uid, createdAt: serverTimestamp() });
        tx.set(userRef, {
          uid: user.uid,
          nickname: trimmed,
          nickname_lc: normalized,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      onDone?.();
    } catch (e) {
      setError(e.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16, textAlign: "center", color: "#fff" }}>Checking profile...</div>;

  return (
    <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 420, textAlign: "center" }}>
      <h2 style={{ marginTop: 0 }}>Choose your nickname</h2>
      <p style={{ opacity: 0.85, marginTop: 6 }}>You will use it in multiplayer. You cannot change it ever.</p>
      <input
        value={nick}
        onChange={(e) => setNick(e.target.value)}
        placeholder="tu_nick"
        maxLength={20}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "0.6rem 0.8rem",
          borderRadius: 8,
          border: "1px solid #374151",
          background: "#0b1220",
          color: "#fff",
          outline: "none",
        }}
      />
      <button
        disabled={saving}
        onClick={handleSave}
        style={{
          marginTop: 12,
          padding: "0.6rem 1rem",
          background: saving ? "#6b7280" : "#10b981",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: saving ? "not-allowed" : "pointer",
          fontWeight: 600,
        }}
      >
        Save
      </button>
      {error && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>{error}</div>}
    </div>
  );
}


