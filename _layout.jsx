import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { auth, db } from '../config/firebase';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';

export default function AuthLayout() {
  useEffect(() => {
    // If user is already authenticated, redirect them
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          // Check if user is a driver by looking up in the drivers collection
          const driverRef = doc(db, 'drivers', user.uid);
          const driverDoc = await getDoc(driverRef);

          if (driverDoc.exists()) {
            router.replace('/(driver)/home');
          } else {
            router.replace('/(user)/request-tow');
          }
        } catch (error) {
          console.error('Error checking user type:', error);
          // On error, stay on auth page
        }
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="user-login" 
        options={{
          gestureEnabled: false,
          headerLeft: () => null
        }}
      />
      <Stack.Screen 
        name="user-signup" 
        options={{
          gestureEnabled: false,
          headerLeft: () => null
        }}
      />
      <Stack.Screen 
        name="driver-login" 
        options={{
          gestureEnabled: false,
          headerLeft: () => null
        }}
      />
      <Stack.Screen 
        name="driver-signup" 
        options={{
          gestureEnabled: false,
          headerLeft: () => null
        }}
      />
    </Stack>
  );
}
