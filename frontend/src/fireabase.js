import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAT7B81MVjsWwejTG8hPCeXZMLF5BCGs3E",
  authDomain: "italks-b0325.firebaseapp.com",
  projectId: "italks-b0325",
  storageBucket: "italks-b0325.firebasestorage.app",
  messagingSenderId: "398312982444",
  appId: "1:398312982444:web:06af9b4d1d16b386e89c09"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);