import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking
} from 'react-native';
import { router } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { 
  addDoc, 
  collection, 
  serverTimestamp, 
  query, 
  where, 
  getDocs, 
  GeoPoint, 
  onSnapshot,
  doc,
  updateDoc,
  arrayUnion
} from 'firebase/firestore';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.0922;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

// Function to calculate distance between two points using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c; // Distance in km
  return distance;
};

export default function RequestTow() {
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [description, setDescription] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [searchingDrivers, setSearchingDrivers] = useState(false);
  const [foundDrivers, setFoundDrivers] = useState([]);
  const [currentRequestId, setCurrentRequestId] = useState(null);
  const mapRef = useRef(null);

  const requestLocationPermission = async () => {
    try {
      setLoading(true);
      setPermissionDenied(false);
      
      let { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoading(false);
        return false;
      }
      
      // Get current location
      let currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      
      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,
      });
      
      setLoading(false);
      return true;
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get your location. Please check your device settings.');
      setLoading(false);
      return false;
    }
  };

  useEffect(() => {
    (async () => {
      // Check if user is authenticated
      if (!auth.currentUser) {
        router.replace('/(auth)/user-login');
        return;
      }
      
      // Request location permissions
      await requestLocationPermission();
    })();
  }, []);

  // Handle finding nearby available drivers
  const findNearbyDrivers = async (userLocation) => {
    try {
      // Query online and available drivers
      const driversQuery = query(
        collection(db, 'drivers'),
        where('isOnline', '==', true),
        where('isAvailable', '==', true)
      );
      
      const querySnapshot = await getDocs(driversQuery);
      
      if (querySnapshot.empty) {
        return [];
      }
      
      // Calculate distance for each driver and sort by proximity
      const drivers = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          distance: doc.data().currentLocation 
            ? calculateDistance(
                userLocation.latitude, 
                userLocation.longitude, 
                doc.data().currentLocation.latitude, 
                doc.data().currentLocation.longitude
              )
            : 9999 // If no location, place at the end
        }))
        .sort((a, b) => a.distance - b.distance); // Sort by proximity (closest first)
      
      return drivers;
    } catch (error) {
      console.error('Error finding nearby drivers:', error);
      return [];
    }
  };

  // Function to send request to a specific driver
  const sendRequestToDriver = async (requestId, driverId) => {
    try {
      await updateDoc(doc(db, 'towRequests', requestId), {
        notifiedDriverIds: arrayUnion(driverId),
        pendingDriverId: driverId,
        updatedAt: serverTimestamp()
      });
      
      // Here we would also send a push notification to the driver
      // This would be integrated with a notification service like Firebase Cloud Messaging
      console.log(`Request sent to driver ${driverId}`);
      
      // Wait for driver response (accept/reject) with a timeout
      return new Promise((resolve) => {
        const unsubscribe = onSnapshot(doc(db, 'towRequests', requestId), (docSnapshot) => {
          if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            
            // If driver accepted
            if (data.status === 'accepted' && data.driverId === driverId) {
              unsubscribe();
              resolve({ accepted: true, driver: { id: driverId } });
            }
            
            // If driver rejected or timeout (pendingDriverId cleared or changed)
            if (!data.pendingDriverId || data.pendingDriverId !== driverId) {
              unsubscribe();
              resolve({ accepted: false });
            }
          }
        });
        
        // Set timeout for driver response (30 seconds)
        setTimeout(() => {
          unsubscribe();
          resolve({ accepted: false, timeout: true });
        }, 30000);
      });
    } catch (error) {
      console.error('Error sending request to driver:', error);
      return { accepted: false, error: true };
    }
  };

  // Function to handle the driver request process
  const processDriverRequests = async (requestId, drivers) => {
    // Create a copy so we don't modify the original array
    const availableDrivers = [...drivers];
    
    // Try each driver in order until one accepts or we run out of drivers
    while (availableDrivers.length > 0) {
      const nextDriver = availableDrivers.shift();
      
      // Update UI to show searching status
      setSearchingDrivers(true);
      
      // Send request to the driver and wait for response
      const { accepted } = await sendRequestToDriver(requestId, nextDriver.id);
      
      if (accepted) {
        // If a driver accepted, navigate to the status page
        setSearchingDrivers(false);
        
        Alert.alert(
          'Driver Found',
          `A driver has accepted your request and is on the way.`,
          [
            {
              text: 'OK',
              onPress: () => router.replace({
                pathname: '/(user)/request-status',
                params: { requestId }
              })
            }
          ]
        );
        return true;
      }
      
      // If driver didn't accept, continue to next driver
    }
    
    // If no drivers accepted
    setSearchingDrivers(false);
    
    // Update request status to "no drivers available"
    await updateDoc(doc(db, 'towRequests', requestId), {
      status: 'no_drivers',
      updatedAt: serverTimestamp()
    });
    
    Alert.alert(
      'No Drivers Available',
      'We couldn\'t find an available driver at this time. Please try again later.',
      [
        {
          text: 'OK',
          onPress: () => setIsSubmitting(false)
        }
      ]
    );
    
    return false;
  };

  const handleMapPress = (event) => {
    setLocation({
      ...location,
      latitude: event.nativeEvent.coordinate.latitude,
      longitude: event.nativeEvent.coordinate.longitude,
    });
  };

  const handleMapReady = () => {
    setMapReady(true);
  };

  const handleMapError = (error) => {
    console.error('Map loading error:', error);
    setMapError(true);
    setMapReady(true); // Consider the map "ready" even though it has errors
  };

  const openSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const handleRequestTow = async () => {
    if (!location) {
      Alert.alert('Error', 'Please select a location on the map');
      return;
    }

    if (!description) {
      Alert.alert('Error', 'Please provide a brief description of your issue');
      return;
    }

    if (!vehicleType) {
      Alert.alert('Error', 'Please provide your vehicle type');
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Create a new tow request in Firestore
      const requestRef = await addDoc(collection(db, 'towRequests'), {
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email,
        userName: auth.currentUser.displayName,
        userPhone: auth.currentUser.phoneNumber,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        description,
        vehicleType,
        status: 'searching', // searching, pending, accepted, completed, cancelled, no_drivers
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        driverId: null,
        pendingDriverId: null,
        notifiedDriverIds: [],
        estimatedArrival: null,
      });
      
      const requestId = requestRef.id;
      setCurrentRequestId(requestId);
      
      // Find nearby drivers
      const nearbyDrivers = await findNearbyDrivers({
        latitude: location.latitude,
        longitude: location.longitude
      });
      
      setFoundDrivers(nearbyDrivers);
      
      if (nearbyDrivers.length === 0) {
        // No nearby drivers found
        await updateDoc(doc(db, 'towRequests', requestId), {
          status: 'no_drivers',
          updatedAt: serverTimestamp()
        });
        
        Alert.alert(
          'No Drivers Available',
          'Sorry, there are no drivers available in your area at the moment. Please try again later.',
          [
            {
              text: 'OK',
              onPress: () => setIsSubmitting(false)
            }
          ]
        );
        return;
      }
      
      // Process driver requests
      await processDriverRequests(requestId, nearbyDrivers);
      
    } catch (error) {
      console.error('Error submitting tow request:', error);
      Alert.alert('Error', 'Failed to submit your request. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  if (searchingDrivers) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Finding a driver for you...</Text>
        <Text style={styles.subText}>
          This may take a moment as we connect you with the closest available driver.
        </Text>
      </View>
    );
  }

  if (permissionDenied) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerContainer}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Request a Tow</Text>
          </View>
        </LinearGradient>
        
        <View style={styles.permissionContainer}>
          <Ionicons name="location-off" size={80} color="#ccc" />
          <Text style={styles.permissionTitle}>Location Access Required</Text>
          <Text style={styles.permissionText}>
            We need access to your location to connect you with nearby tow trucks.
            Please enable location permissions in your device settings.
          </Text>
          <View style={styles.permissionButtons}>
            <TouchableOpacity 
              style={[styles.requestButton, styles.permissionButton]} 
              onPress={openSettings}
            >
              <Text style={styles.requestButtonText}>Open Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.requestButton, styles.tryAgainButton]} 
              onPress={requestLocationPermission}
            >
              <Text style={styles.requestButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerContainer}>
        <View style={styles.header}>
          {/*<TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>*/}
          <Text style={styles.title}>Request a Tow</Text>
        </View>
      </LinearGradient>

      <View style={styles.mapContainer}>
        {location && !mapError && (
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={location}
            showsUserLocation
            showsMyLocationButton
            onPress={handleMapPress}
            onMapReady={handleMapReady}
            onError={handleMapError}
          >
            <Marker
              coordinate={{
                latitude: location.latitude,
                longitude: location.longitude,
              }}
              title="Pickup Location"
              description="This is where the tow truck will go"
              pinColor="#1e3c72"
            />
          </MapView>
        )}
        
        {mapError && (
          <View style={[styles.map, styles.mapErrorContainer]}>
            <Ionicons name="map-outline" size={60} color="#ccc" />
            <Text style={styles.mapErrorTitle}>Map Unavailable</Text>
            <Text style={styles.mapErrorText}>
              We're having trouble loading the map. You can still request a tow using your current location.
            </Text>
          </View>
        )}
        
        {!mapReady && !mapError && (
          <View style={[styles.map, styles.mapLoadingOverlay]}>
            <ActivityIndicator size="large" color="#1e3c72" />
          </View>
        )}
        
        {!mapError && (
          <View style={styles.mapInstructions}>
            <Text style={styles.mapInstructionsText}>
              Tap to set pickup location
            </Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.formContainer}>
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>Pickup Details</Text>
          
          <View style={styles.inputContainer}>
            <Ionicons name="information-circle-outline" size={20} color="#555" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Describe your issue"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              placeholderTextColor="#999"
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="car-outline" size={20} color="#555" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Vehicle type (e.g. Sedan, SUV, Truck)"
              value={vehicleType}
              onChangeText={setVehicleType}
              placeholderTextColor="#999"
            />
          </View>

          <TouchableOpacity
            style={[styles.requestButton, isSubmitting && styles.requestButtonDisabled]}
            onPress={handleRequestTow}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="car-sport" size={20} color="#fff" style={styles.buttonIcon} />
                <Text style={styles.requestButtonText}>Request Tow Truck</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
    fontWeight: 'bold',
  },
  subText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    maxWidth: '80%',
  },
  headerContainer: {
    paddingTop: 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: 10,
    marginRight: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e3c72',
    marginTop: 20,
    marginBottom: 10,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 30,
    lineHeight: 24,
  },
  permissionButtons: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
  },
  permissionButton: {
    flex: 1,
    marginRight: 10,
  },
  tryAgainButton: {
    flex: 1,
    marginLeft: 10,
    backgroundColor: '#4CAF50',
  },
  mapContainer: {
    height: height * 0.35,
    width: '100%',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapLoadingOverlay: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapErrorContainer: {
    backgroundColor: '#f5f7fa',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mapErrorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e3c72',
    marginTop: 10,
    marginBottom: 5,
  },
  mapErrorText: {
    fontSize: 14,
    textAlign: 'center',
    color: '#666',
    lineHeight: 20,
  },
  mapInstructions: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 5,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  mapInstructionsText: {
    color: '#fff',
    fontSize: 12,
  },
  markerContainer: {
    alignItems: 'center',
  },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1e3c72',
    position: 'absolute',
    bottom: -4,
  },
  formContainer: {
    flex: 1,
    padding: 20,
  },
  formSection: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#1e3c72',
  },
  inputContainer: {
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eaeaea',
  },
  inputIcon: {
    padding: 10,
    color: '#1e3c72',
  },
  input: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  requestButton: {
    backgroundColor: '#1e3c72',
    borderRadius: 10,
    padding: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
  },
  requestButtonDisabled: {
    opacity: 0.7,
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonIcon: {
    marginRight: 10,
  },
});

