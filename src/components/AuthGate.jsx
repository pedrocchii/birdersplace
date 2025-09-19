import { useEffect, useState } from "react";
import { auth, googleProvider } from "../firebaseClient";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <div style={{ padding: 16, textAlign: "center" }}>Cargando...</div>;

  async function handleGoogleSignIn() {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const code = e?.code || "unknown";
      // eslint-disable-next-line no-console
      console.error("Auth error:", code, e?.message);
      if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setError(code);
    }
  }

  if (!user) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 360, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Birders Place</h2>
          <p style={{ opacity: 0.85 }}>Inicia sesión para jugar</p>
          <button
            onClick={handleGoogleSignIn}
            style={{
              marginTop: 12,
              padding: "0.6rem 1rem",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Continuar con Google
          </button>
          {error && (
            <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>
              Error: {error}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>Dominio actual: {window.location.hostname}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "fixed", right: 12, top: 12, display: "flex", gap: 8, alignItems: "center", zIndex: 1000 }}>
        <span style={{ color: "#fff", background: "#1f2937", padding: "4px 8px", borderRadius: 8 }}>{user.displayName || user.email}</span>
        <button onClick={() => signOut(auth)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Salir</button>
      </div>
      {children}
    </div>
  );
}


