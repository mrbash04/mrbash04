import { useState, useEffect } from 'react';
import { auth, db } from '../config/firebase';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      if (authUser) {
        setUser(authUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const signUpUser = async (email, password, userData) => {
    try {
      setLoading(true);
      setError(null);
      
      // Create authentication account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create user profile in Firestore
      await setDoc(doc(db, 'users', user.uid), {
        ...userData,
        userId: user.uid,
        email,
        createdAt: new Date().toISOString(),
        type: 'user',
        totalRides: 0,
        favoriteDrivers: [],
        paymentMethods: [],
        lastLocation: null
      });

      return user;
    } catch (err) {
      console.error(err.message);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUpDriver = async (email, password, driverData) => {
    try {
      setLoading(true);
      setError(null);
      
      // Create authentication account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create driver profile in Firestore
      await setDoc(doc(db, 'drivers', user.uid), {
        ...driverData,
        userId: user.uid,
        email,
        createdAt: new Date().toISOString(),
        isOnline: false,
        isAvailable: false,
        rating: 0,
        totalRides: 0,
        currentLocation: null
      });

      return user;
    } catch (err) {
      console.error(err.message);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loginUser = async (email, password, userType = 'user') => {
    try {
      setLoading(true);
      setError(null);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      setError(null);
      await signOut(auth);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    user,
    signUpUser,
    signUpDriver,
    loginUser,
    logout,
    loading,
    error
  };
}; 