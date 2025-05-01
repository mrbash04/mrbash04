import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  FlatList,
  Alert,
  ActivityIndicator,
  Dimensions,
  Image
} from 'react-native';
import { router } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { 
  doc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  getDocs
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

// Calculate ETA based on distance
const calculateETA = (distanceInKm) => {
  // Assume average speed of 40 km/h
  const timeInHours = distanceInKm / 40;
  const timeInMinutes = Math.round(timeInHours * 60);
  return timeInMinutes;
};

export default function DriverHome() {
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [driverData, setDriverData] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [todayStats, setTodayStats] = useState({
    completedJobs: 0,
    earnings: 0,
    totalTrips: 0,
    totalEarnings: 0
  });
  const mapRef = useRef(null);

  useEffect(() => {
    // Check if driver is authenticated
    if (!auth.currentUser) {
      router.replace('/(auth)/driver-login');
      return;
    }

    const driverId = auth.currentUser.uid;

    // Get driver data and today's stats
    const fetchDriverData = async () => {
      try {
        const driverDoc = await getDoc(doc(db, 'drivers', driverId));
        if (driverDoc.exists()) {
          const data = driverDoc.data();
          setDriverData(data);
          setIsOnline(data.isOnline || false);
        } else {
          console.log('No driver data found');
          Alert.alert('Error', 'No driver account found. Please contact support.');
        }
        
        // Fetch today's stats
        await fetchTodayStats(driverId);
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching driver data:', error);
        Alert.alert('Error', 'Failed to load driver data');
        setLoading(false);
      }
    };

    fetchDriverData();

    // Request location permissions
    requestLocationPermission();

    // Listen for active request
    const activeRequestUnsub = onSnapshot(
      query(
        collection(db, 'towRequests'),
        where('driverId', '==', driverId),
        where('status', 'in', ['accepted', 'in_progress'])
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          // Found an active request
          const requestData = {
            id: snapshot.docs[0].id,
            ...snapshot.docs[0].data()
          };
          setActiveRequest(requestData);
        } else {
          setActiveRequest(null);
        }
      },
      (error) => {
        console.error('Error getting active request:', error);
      }
    );

    // Listen for incoming requests
    const pendingRequestsUnsub = onSnapshot(
      query(
        collection(db, 'towRequests'),
        where('pendingDriverId', '==', driverId),
        where('status', '==', 'searching')
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          // Found pending requests
          const requestsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            distance: doc.data().location && currentLocation ? 
              calculateDistance(
                currentLocation.latitude,
                currentLocation.longitude,
                doc.data().location.latitude,
                doc.data().location.longitude
              ) : null,
            eta: doc.data().location && currentLocation ? 
              calculateETA(calculateDistance(
                currentLocation.latitude,
                currentLocation.longitude,
                doc.data().location.latitude,
                doc.data().location.longitude
              )) : null
          }));
          setPendingRequests(requestsData);
        } else {
          setPendingRequests([]);
        }
      },
      (error) => {
        console.error('Error getting pending requests:', error);
      }
    );

    // Cleanup
    return () => {
      activeRequestUnsub();
      pendingRequestsUnsub();
    };
  }, []);

  // Location tracking for driver
  useEffect(() => {
    if (!isOnline || !currentLocation) return;

    const locationUpdateInterval = setInterval(async () => {
      if (!auth.currentUser) return;

      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });

        const newLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        };

        // Update driver's location in Firestore
        await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
          currentLocation: newLocation,
          lastLocationUpdate: serverTimestamp()
        });

        // If there's an active request, update the driver's location on that request too
        if (activeRequest) {
          await updateDoc(doc(db, 'towRequests', activeRequest.id), {
            driverLocation: newLocation,
            updatedAt: serverTimestamp()
          });
        }

        setCurrentLocation(newLocation);
      } catch (error) {
        console.error('Error updating location:', error);
      }
    }, 30000); // Update every 30 seconds

    return () => clearInterval(locationUpdateInterval);
  }, [isOnline, currentLocation, activeRequest]);

  const requestLocationPermission = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setLocationPermissionDenied(true);
        return false;
      }
      
      // Get current location
      let location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      
      const newLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,
      };
      
      setCurrentLocation(newLocation);
      
      // Update driver's location in Firestore
      if (auth.currentUser) {
        await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
          currentLocation: {
            latitude: newLocation.latitude,
            longitude: newLocation.longitude
          },
          lastLocationUpdate: serverTimestamp()
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get your location. Please check your device settings.');
      return false;
    }
  };

  const handleToggleOnline = async (value) => {
    try {
      if (value && !currentLocation) {
        // Going online but no location
        const hasLocation = await requestLocationPermission();
        if (!hasLocation) {
          Alert.alert(
            'Location Required',
            'You need to enable location services to go online and receive tow requests.'
          );
          return;
        }
      }

      await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
        isOnline: value,
        isAvailable: value, // Initially available when going online
        lastStatusUpdate: serverTimestamp()
      });

      setIsOnline(value);
    } catch (error) {
      console.error('Error updating online status:', error);
      Alert.alert('Error', 'Failed to update your status');
    }
  };

  const handleAcceptRequest = async (requestId) => {
    try {
      // Update the request
      await updateDoc(doc(db, 'towRequests', requestId), {
        status: 'accepted',
        driverId: auth.currentUser.uid,
        pendingDriverId: null,
        updatedAt: serverTimestamp(),
        driverLocation: {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        },
        estimatedArrival: serverTimestamp() // This should be calculated based on distance
      });

      // Update driver status
      await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
        isAvailable: false,
        activeRequestId: requestId,
        updatedAt: serverTimestamp()
      });

      // Navigate to the job screen
      router.push({
        pathname: '/(driver)/active-job',
        params: { requestId }
      });
    } catch (error) {
      console.error('Error accepting request:', error);
      Alert.alert('Error', 'Failed to accept request');
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      // Update the request to remove this driver from pending
      await updateDoc(doc(db, 'towRequests', requestId), {
        pendingDriverId: null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error rejecting request:', error);
      Alert.alert('Error', 'Failed to reject request');
    }
  };

  const handleMapReady = () => {
    setMapReady(true);
  };

  const fetchTodayStats = async (driverId) => {
    try {
      // Get today's start and end timestamps
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get driver's total stats
      const driverDoc = await getDoc(doc(db, 'drivers', driverId));
      const driverData = driverDoc.data();
      const totalTrips = driverData?.totalRides || 0;
      const totalEarnings = driverData?.totalEarnings || 0;

      // Query completed requests for today
      const requestsQuery = query(
        collection(db, 'towRequests'),
        where('driverId', '==', driverId),
        where('status', '==', 'completed'),
        where('completedAt', '>=', today),
        where('completedAt', '<', tomorrow)
      );

      const querySnapshot = await getDocs(requestsQuery);
      
      let stats = {
        completedJobs: 0,
        earnings: 0,
        totalTrips,
        totalEarnings
      };

      querySnapshot.forEach((doc) => {
        const request = doc.data();
        stats.completedJobs++;
        stats.earnings += request.earnings || 0;
      });

      setTodayStats(stats);
    } catch (error) {
      console.error('Error fetching today\'s stats:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Loading driver dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#4a1259', '#7c2ab9']} style={styles.headerContainer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hey, {driverData?.fullName?.split(' ')[0] || 'there'}</Text>
            <Text style={styles.subtitle}>Let's get you on the road</Text>
          </View>
          <View style={styles.onlineContainer}>
            <Text style={styles.onlineText}>{isOnline ? 'Online' : 'Offline'}</Text>
            <Switch
              trackColor={{ false: '#767577', true: '#81b0ff' }}
              thumbColor={isOnline ? '#4CAF50' : '#f4f3f4'}
              ios_backgroundColor="#3e3e3e"
              onValueChange={handleToggleOnline}
              value={isOnline}
            />
          </View>
        </View>
      </LinearGradient>

      {!isOnline ? (
        <View style={styles.offlineContainer}>
          <Ionicons name="power" size={80} color="#ccc" />
          <Text style={styles.offlineTitle}>You're offline</Text>
          <Text style={styles.offlineText}>
            Go online to start receiving tow requests from users in your area.
          </Text>
          <TouchableOpacity
            style={styles.goOnlineButton}
            onPress={() => handleToggleOnline(true)}
          >
            <Text style={styles.goOnlineText}>Go Online</Text>
          </TouchableOpacity>
        </View>
      ) : activeRequest ? (
        <View style={styles.activeRequestContainer}>
          <Text style={styles.sectionTitle}>Active Request</Text>
          <View style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestTime}>Request ID: {activeRequest.id.substring(0, 6)}...</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>In Progress</Text>
              </View>
            </View>
            
            <View style={styles.customerInfo}>
              <View style={styles.customerAvatar}>
                <Ionicons name="person-circle" size={40} color="#1e3c72" />
              </View>
              <View style={styles.customerDetails}>
                <Text style={styles.customerName}>{activeRequest.userName || 'Customer'}</Text>
                <Text style={styles.vehicleInfo}>{activeRequest.vehicleType || 'Vehicle'}</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.viewJobButton}
              onPress={() => router.push({
                pathname: '/(driver)/active-job',
                params: { requestId: activeRequest.id }
              })}
            >
              <Text style={styles.viewJobText}>View Job Details</Text>
              <Ionicons name="chevron-forward" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : pendingRequests.length > 0 ? (
        <View style={styles.pendingContainer}>
          <Text style={styles.sectionTitle}>New Request</Text>
          <View style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestTime}>New Tow Request</Text>
              <View style={styles.countdownBadge}>
                <Text style={styles.countdownText}>30s</Text>
              </View>
            </View>
            
            <View style={styles.requestDetails}>
              <View style={styles.detailRow}>
                <Ionicons name="car-outline" size={18} color="#555" />
                <Text style={styles.detailText}>{pendingRequests[0].vehicleType || 'Vehicle'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Ionicons name="information-circle-outline" size={18} color="#555" />
                <Text style={styles.detailText} numberOfLines={2}>
                  {pendingRequests[0].description || 'No description provided'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Ionicons name="navigate-outline" size={18} color="#555" />
                <Text style={styles.detailText}>
                  {pendingRequests[0].distance ? 
                    `${pendingRequests[0].distance.toFixed(1)} km away` : 
                    'Distance not available'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={18} color="#555" />
                <Text style={styles.detailText}>
                  {pendingRequests[0].eta ? 
                    `${pendingRequests[0].eta} min ETA` : 
                    'ETA not available'}
                </Text>
              </View>
            </View>
            
            <View style={styles.miniMap}>
              {currentLocation && pendingRequests[0].location && (
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude: currentLocation.latitude,
                    longitude: currentLocation.longitude,
                    latitudeDelta: LATITUDE_DELTA,
                    longitudeDelta: LONGITUDE_DELTA,
                  }}
                  onMapReady={handleMapReady}
                >
                  <Marker
                    coordinate={{
                      latitude: currentLocation.latitude,
                      longitude: currentLocation.longitude,
                    }}
                    title="Your Location"
                    pinColor="#1e3c72"
                  />
                  <Marker
                    coordinate={{
                      latitude: pendingRequests[0].location.latitude,
                      longitude: pendingRequests[0].location.longitude,
                    }}
                    title="Pickup Location"
                    pinColor="#e74c3c"
                  />
                </MapView>
              )}
            </View>
            
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.rejectButton]}
                onPress={() => handleRejectRequest(pendingRequests[0].id)}
              >
                <Text style={styles.rejectText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.acceptButton]}
                onPress={() => handleAcceptRequest(pendingRequests[0].id)}
              >
                <Text style={styles.acceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.noRequestsContainer}>
          <View style={styles.mapContainer}>
            {currentLocation && (
              <MapView
                style={styles.map}
                initialRegion={currentLocation}
                showsUserLocation
                onMapReady={handleMapReady}
              >
                <Marker
                  coordinate={{
                    latitude: currentLocation.latitude,
                    longitude: currentLocation.longitude,
                  }}
                  title="Your Location"
                  description="You are here"
                  pinColor="#1e3c72"
                />
              </MapView>
            )}
          </View>
          <View style={styles.statsContainer}>
            <Text style={styles.sectionTitle}>My Stats</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{todayStats.completedJobs}</Text>
                <Text style={styles.statLabel}>Today's Jobs</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>&#8358;{todayStats.earnings.toFixed(2)}</Text>
                <Text style={styles.statLabel}>Today's Earnings</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{todayStats.totalTrips}</Text>
                <Text style={styles.statLabel}>Total Trips</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>&#8358;{todayStats.totalEarnings.toFixed(2)}</Text>
                <Text style={styles.statLabel}>Total Earnings</Text>
              </View>
            </View>
          </View>
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>
              You're online and ready to receive requests
            </Text>
            <ActivityIndicator size="small" color="#1e3c72" style={styles.waitingSpinner} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },
  headerContainer: {
    paddingTop: 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#e0e0e0',
    marginTop: 5,
  },
  onlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineText: {
    color: '#fff',
    marginRight: 10,
  },
  offlineContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  offlineTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e3c72',
    marginTop: 20,
    marginBottom: 10,
  },
  offlineText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 30,
    lineHeight: 24,
  },
  goOnlineButton: {
    backgroundColor: '#4a1259',
    borderRadius: 10,
    padding: 15,
    width: '80%',
    alignItems: 'center',
  },
  goOnlineText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  noRequestsContainer: {
    flex: 1,
    padding: 0,
  },
  mapContainer: {
    height: height * 0.35,
    width: '100%',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  statsContainer: {
    padding: 20,
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 15,
    marginTop: -30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4a1259',
    marginBottom: 15,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4a1259',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  waitingContainer: {
    marginTop: 20,
    padding: 20,
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 10,
  },
  waitingSpinner: {
    marginTop: 10,
  },
  pendingContainer: {
    flex: 1,
    padding: 20,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  requestTime: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  countdownBadge: {
    backgroundColor: '#f39c12',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  countdownText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  statusBadge: {
    backgroundColor: '#4a1259',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  requestDetails: {
    marginBottom: 15,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailText: {
    marginLeft: 10,
    color: '#333',
    flex: 1,
  },
  miniMap: {
    height: 150,
    marginVertical: 15,
    borderRadius: 10,
    overflow: 'hidden',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    backgroundColor: '#f8f9fa',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
    marginLeft: 10,
  },
  rejectText: {
    color: '#e74c3c',
    fontWeight: 'bold',
  },
  acceptText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  activeRequestContainer: {
    flex: 1,
    padding: 20,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  customerAvatar: {
    marginRight: 15,
  },
  customerDetails: {
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  vehicleInfo: {
    fontSize: 14,
    color: '#666',
    marginTop: 3,
  },
  viewJobButton: {
    backgroundColor: '#4a1259',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 15,
  },
  viewJobText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
}); 