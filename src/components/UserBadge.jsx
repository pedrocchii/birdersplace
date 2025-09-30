import { useEffect, useState } from "react";
import { auth, db } from "../firebaseClient";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export default function UserBadge() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      if (u) {
        try {
          const userRef = doc(db, "users", u.uid);
          const snap = await getDoc(userRef);
          const nick = snap.exists() ? (snap.data()?.nickname || "") : "";
          setNickname(nick);
        } catch {
          setNickname("");
        }
      } else {
        setNickname("");
      }
    });
    return () => unsub();
  }, []);

  if (!user) return null;

  return (
    <div style={{ position: "fixed", right: 12, top: 12, display: "flex", gap: 8, alignItems: "center", zIndex: 1000 }}>
      <span style={{ color: "#fff", background: "#1f2937", padding: "4px 8px", borderRadius: 8 }}>
        {nickname || user.displayName || user.email}
      </span>
      <button onClick={() => signOut(auth)} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Sign Out</button>
    </div>
  );
}


