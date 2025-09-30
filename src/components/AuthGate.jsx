import { useEffect, useState } from "react";
import { auth, googleProvider } from "../firebaseClient";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <div style={{ padding: 16, textAlign: "center" }}>Loading...</div>;

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

  async function handleEmailAuth() {
    if (!email || !password) {
      setError("Please complete all fields");
      return;
    }

    setError("");
    setAuthLoading(true);

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      const code = e?.code || "unknown";
      console.error("Email auth error:", code, e?.message);
      
      // Traducir errores comunes
      const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered',
        'auth/weak-password': 'Password must be at least 6 characters',
        'auth/invalid-email': 'Invalid email',
        'auth/user-not-found': 'No account exists with this email',
        'auth/wrong-password': 'Incorrect password',
        'auth/too-many-requests': 'Too many failed attempts. Try again later'
      };
      
      setError(errorMessages[code] || code);
    } finally {
      setAuthLoading(false);
    }
  }

  if (!user) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "fixed", left: 12, top: 12, zIndex: 1000 }}>
          <button 
            onClick={() => window.location.href = "?view=menu"}
            style={{ 
              padding: "6px 10px", 
              borderRadius: 8, 
              border: "none", 
              background: "#374151", 
              color: "#fff", 
              cursor: "pointer" 
            }}
          >
            Back
          </button>
        </div>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 400, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Birders Place</h2>
          <p style={{ opacity: 0.85, marginBottom: 20 }}>Sign in to play</p>
          
          {/* Email form */}
          <div style={{ marginBottom: 20 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                padding: "0.6rem",
                marginBottom: 10,
                borderRadius: 8,
                border: "1px solid #374151",
                background: "#0b1220",
                color: "#fff",
                fontSize: 14
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "0.6rem",
                marginBottom: 10,
                borderRadius: 8,
                border: "1px solid #374151",
                background: "#0b1220",
                color: "#fff",
                fontSize: 14
              }}
            />
            <button
              onClick={handleEmailAuth}
              disabled={authLoading}
              style={{
                width: "100%",
                padding: "0.6rem",
                marginBottom: 10,
                background: authLoading ? "#6b7280" : "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: authLoading ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 600
              }}
            >
              {authLoading ? "Loading..." : (isSignUp ? "Sign Up" : "Sign In")}
            </button>
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              style={{
                background: "transparent",
                color: "#9ca3af",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                textDecoration: "underline"
              }}
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
            </button>
          </div>

          {/* Separator */}
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            margin: "20px 0",
            color: "#6b7280",
            fontSize: 12
          }}>
            <div style={{ flex: 1, height: 1, background: "#374151" }}></div>
            <span style={{ margin: "0 10px" }}>o</span>
            <div style={{ flex: 1, height: 1, background: "#374151" }}></div>
          </div>

          {/* Google button */}
          <button
            onClick={handleGoogleSignIn}
            style={{
              width: "100%",
              padding: "0.6rem",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600
            }}
          >
            Continue with Google
          </button>

          {error && (
            <div style={{ marginTop: 15, color: "#fca5a5", fontSize: 12 }}>
              {error}
            </div>
          )}
          <div style={{ marginTop: 15, fontSize: 11, opacity: 0.65 }}>Current domain: {window.location.hostname}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "fixed", right: 12, top: 12, display: "flex", gap: 8, alignItems: "center", zIndex: 1000 }}>
        <span style={{ color: "#fff", background: "#1f2937", padding: "4px 8px", borderRadius: 8 }}>{user.displayName || user.email}</span>
        <button onClick={() => signOut(auth)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Sign Out</button>
      </div>
      {children}
    </div>
  );
}


