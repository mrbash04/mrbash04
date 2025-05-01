import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCafeNIYOfmSHcQ2nnxgvSKfUtuf37Vc4Y",
  authDomain: "good-500a3.firebaseapp.com",
  databaseURL: "https://good-500a3.firebaseio.com",
  projectId: "good-500a3",
  storageBucket: "good-500a3.firebasestorage.app",
  messagingSenderId: "1041424330331",
  appId: "1:1041424330331:web:3db2aadf6889a043b7997e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app); 