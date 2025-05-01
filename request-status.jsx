import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Image,
  ScrollView,
  Linking,
  Platform
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { 
  doc, 
  getDoc, 
  updateDoc, 
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp 
} from 'firebase/firestore';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.0922;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

export default function RequestStatus() {
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [driver, setDriver] = useState(null);
  const [mapRegion, setMapRegion] = useState(null);
  const [mapError, setMapError] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    // Check if user is authenticated
    if (!auth.currentUser) {
      router.replace('/(auth)/user-login');
      return;
    }

    const userId = auth.currentUser.uid;
    
    // If a specific request ID is provided in params, use that
    if (params.requestId) {
      const requestRef = doc(db, 'towRequests', params.requestId);
      
      const unsubscribe = onSnapshot(requestRef, async (doc) => {
        if (doc.exists()) {
          const requestData = {
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            arrivedAt: doc.data().arrivedAt?.toDate(),
            towStartedAt: doc.data().towStartedAt?.toDate(),
            completedAt: doc.data().completedAt?.toDate()
          };
          
          setRequest(requestData);
          
          // If there's a driver assigned, get their information
          if (requestData.driverId) {
            try {
              const driverRef = doc(db, 'drivers', requestData.driverId);
              const driverDoc = await getDoc(driverRef);
              if (driverDoc.exists()) {
                const driverData = driverDoc.data();
                setDriver({
                  id: driverDoc.id,
                  ...driverData,
                  status: driverData.status || 'available'
                });
              }
            } catch (error) {
              console.error('Error fetching driver:', error);
            }
          }
          
          // Set map region to show both user and driver (if available)
          updateMapRegion(requestData);
          
          setLoading(false);
        } else {
          console.log('No such request!');
          setLoading(false);
        }
      }, (error) => {
        console.error('Error fetching request:', error);
        setLoading(false);
      });
      
      return () => unsubscribe();
    } else {
      // Use a simpler query that doesn't require a composite index
      const fetchActiveRequests = async () => {
        try {
          // Simple query with only one where clause - no orderBy to avoid composite index
          const requestsQuery = query(
            collection(db, 'towRequests'),
            where('userId', '==', userId)
          );
          
          const querySnapshot = await getDocs(requestsQuery);
          
          // Filter and sort in JavaScript instead of in the query
          const activeRequests = querySnapshot.docs
            .filter(doc => {
              const status = doc.data().status;
              return status === 'pending' || status === 'accepted';
            })
            .map(doc => ({
              id: doc.id,
              ...doc.data(),
              createdAt: doc.data().createdAt?.toDate()
            }))
            // Sort by createdAt in descending order (newest first)
            .sort((a, b) => {
              // Handle null/undefined dates
              if (!a.createdAt) return 1;
              if (!b.createdAt) return -1;
              // Sort descending (newest first)
              return b.createdAt - a.createdAt;
            });
          
          if (activeRequests.length > 0) {
            const mostRecentRequest = activeRequests[0]; // Already sorted by createdAt desc
            setRequest(mostRecentRequest);
            
            // If there's a driver assigned, get their information
            if (mostRecentRequest.driverId) {
              try {
                const driverRef = doc(db, 'drivers', mostRecentRequest.driverId);
                const driverDoc = await getDoc(driverRef);
                if (driverDoc.exists()) {
                  setDriver({
                    id: driverDoc.id,
                    ...driverDoc.data()
                  });
                }
              } catch (error) {
                console.error('Error fetching driver:', error);
              }
            }
            
            // Set map region to show both user and driver (if available)
            updateMapRegion(mostRecentRequest);
          } else {
            // No active requests
            setRequest(null);
          }
          
          setLoading(false);
          
          // Set up listener for the specific request if found
          if (activeRequests.length > 0) {
            const requestRef = doc(db, 'towRequests', activeRequests[0].id);
            return onSnapshot(requestRef, async (doc) => {
              if (doc.exists()) {
                const updatedRequest = {
                  id: doc.id,
                  ...doc.data(),
                  createdAt: doc.data().createdAt?.toDate()
                };
                
                setRequest(updatedRequest);
                
                // Update driver info if needed
                if (updatedRequest.driverId && (!driver || driver.id !== updatedRequest.driverId)) {
                  try {
                    const driverRef = doc(db, 'drivers', updatedRequest.driverId);
                    const driverDoc = await getDoc(driverRef);
                    if (driverDoc.exists()) {
                      setDriver({
                        id: driverDoc.id,
                        ...driverDoc.data()
                      });
                    }
                  } catch (error) {
                    console.error('Error fetching driver:', error);
                  }
                }
                
                // Update map region
                updateMapRegion(updatedRequest);
              }
            }, (error) => {
              console.error('Error in request listener:', error);
            });
          }
        } catch (error) {
          console.error('Error fetching requests:', error);
          setLoading(false);
          return null;
        }
      };
      
      const unsubscribe = fetchActiveRequests();
      return () => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    }
  }, [params.requestId]);

  const updateMapRegion = (requestData) => {
    if (!requestData || !requestData.location) return;
    
    const userLocation = {
      latitude: requestData.location.latitude,
      longitude: requestData.location.longitude
    };
    
    // If driver has a location, calculate a region that includes both driver and user
    if (requestData.driverLocation) {
      const driverLocation = {
        latitude: requestData.driverLocation.latitude,
        longitude: requestData.driverLocation.longitude
      };
      
      // Calculate the center point between user and driver
      const centerLat = (userLocation.latitude + driverLocation.latitude) / 2;
      const centerLon = (userLocation.longitude + driverLocation.longitude) / 2;
      
      // Calculate the required delta to see both points (with some padding)
      const latDelta = Math.abs(userLocation.latitude - driverLocation.latitude) * 1.5;
      const lonDelta = Math.abs(userLocation.longitude - driverLocation.longitude) * 1.5;
      
      setMapRegion({
        latitude: centerLat,
        longitude: centerLon,
        latitudeDelta: Math.max(latDelta, 0.02),
        longitudeDelta: Math.max(lonDelta, 0.02)
      });
    } else {
      // Just show the user's location
      setMapRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA
      });
    }
  };

  const handleCancelRequest = () => {
    if (!request) return;
    
    const message = request.status === 'pending' 
      ? 'Are you sure you want to cancel this request?'
      : 'A driver has already accepted your request. Cancelling at this stage may incur a cancellation fee. Do you still want to cancel?';
    
    Alert.alert(
      'Cancel Request',
      message,
      [
        {
          text: 'No',
          style: 'cancel'
        },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'towRequests', request.id), {
                status: 'cancelled',
                updatedAt: Timestamp.now()
              });
              
              Alert.alert('Success', 'Your request has been cancelled.');
              router.replace('/(user)/request-tow');
            } catch (error) {
              console.error('Error cancelling request:', error);
              Alert.alert('Error', 'Failed to cancel request');
            }
          }
        }
      ]
    );
  };

  const handleCallDriver = () => {
    if (!driver || !driver.phone) {
      Alert.alert('Error', 'Driver phone number not available');
      return;
    }
    
    const phoneNumber = driver.phone;
    Linking.openURL(`tel:${phoneNumber}`);
  };

  const handleMapError = (error) => {
    console.error('Map loading error:', error);
    setMapError(true);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Loading request status...</Text>
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerContainer}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Request Status</Text>
          </View>
        </LinearGradient>
        
        <View style={styles.noRequestContainer}>
          <Ionicons name="car-outline" size={80} color="#ccc" />
          <Text style={styles.noRequestTitle}>No Active Request</Text>
          <Text style={styles.noRequestText}>
            You don't have any active tow requests at the moment.
          </Text>
          <TouchableOpacity
            style={styles.requestButton}
            onPress={() => router.replace('/(user)/request-tow')}
          >
            <Text style={styles.requestButtonText}>Request a Tow</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Request Status</Text>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusBadge}>
              <Ionicons 
                name={
                  request.status === 'pending' 
                    ? 'time-outline' 
                    : request.status === 'accepted' 
                    ? 'checkmark-circle-outline'
                    : request.status === 'arrived_at_pickup'
                    ? 'car-outline'
                    : request.status === 'in_progress'
                    ? 'construct-outline'
                    : request.status === 'completed'
                    ? 'flag-outline'
                    : 'close-circle-outline'
                } 
                size={24} 
                color="#fff" 
              />
              <Text style={styles.statusText}>
                {request.status === 'pending' 
                  ? 'Pending' 
                  : request.status === 'accepted' 
                  ? 'Driver on the way'
                  : request.status === 'arrived_at_pickup'
                  ? 'Driver arrived'
                  : request.status === 'in_progress'
                  ? 'Towing in progress'
                  : request.status === 'completed'
                  ? 'Completed'
                  : 'Cancelled'}
              </Text>
            </View>
            <Text style={styles.requestTime}>
              Requested: {request.createdAt?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </Text>
          </View>

          <View style={styles.requestDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="car-outline" size={18} color="#555" />
              <Text style={styles.detailText}>{request.vehicleType}</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="information-circle-outline" size={18} color="#555" />
              <Text style={styles.detailText} numberOfLines={2}>{request.description}</Text>
            </View>
          </View>
        </View>

        <View style={styles.mapContainer}>
          {mapRegion && !mapError ? (
            <MapView
              ref={mapRef}
              style={styles.map}
              region={mapRegion}
              onError={handleMapError}
            >
              {/* User Pickup Location Marker */}
              <Marker
                coordinate={{
                  latitude: request.location.latitude,
                  longitude: request.location.longitude,
                }}
                title="Pickup Location"
                description="Your vehicle location"
              />
              
              {/* Driver Location Marker (if available) */}
              {request.driverLocation && (
                <Marker
                  coordinate={{
                    latitude: request.driverLocation.latitude,
                    longitude: request.driverLocation.longitude,
                  }}
                  title="Driver Location"
                  description="Your tow truck driver"
                />
              )}
            </MapView>
          ) : (
            <View style={[styles.map, styles.mapErrorContainer]}>
              <Ionicons name="map-outline" size={60} color="#ccc" />
              <Text style={styles.mapErrorTitle}>Map Unavailable</Text>
              <Text style={styles.mapErrorText}>
                Unable to load the map. Your request is still being processed.
              </Text>
            </View>
          )}
        </View>

        {driver && (
          <View style={styles.driverCard}>
            <Text style={styles.driverTitle}>Tow Truck Driver</Text>
            
            <View style={styles.driverInfo}>
              <View style={styles.driverAvatar}>
                <Ionicons name="person-circle" size={60} color="#1e3c72" />
              </View>
              
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>{driver.fullName || "Driver Name"}</Text>
                <View style={styles.detailItem}>
                  <Ionicons name="star" size={16} color="#FFD700" />
                  <Text style={styles.detailText}>{driver.rating || "4.8"}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Ionicons name="car" size={16} color="#555" />
                  <Text style={styles.detailText}>{driver.vehicleInfo || "Tow Truck"}</Text>
                </View>
              </View>
            </View>
            
            <TouchableOpacity 
              style={styles.callButton}
              onPress={handleCallDriver}
            >
              <Ionicons name="call" size={20} color="#fff" />
              <Text style={styles.callButtonText}>Call Driver</Text>
            </TouchableOpacity>
          </View>
        )}

        {request.status === 'pending' || request.status === 'accepted' ? (
          <TouchableOpacity 
            style={styles.cancelButton}
            onPress={handleCancelRequest}
          >
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.cancelButtonText}>Cancel Request</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            style={styles.newRequestButton}
            onPress={() => router.replace('/(user)/request-tow')}
          >
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.newRequestButtonText}>New Request</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
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
  content: {
    flex: 1,
  },
  noRequestContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noRequestTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  noRequestText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 30,
  },
  requestButton: {
    backgroundColor: '#1e3c72',
    borderRadius: 10,
    padding: 15,
    width: '80%',
    alignItems: 'center',
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusCard: {
    backgroundColor: '#fff',
    margin: 15,
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e3c72',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 5,
  },
  requestTime: {
    color: '#666',
    fontSize: 14,
  },
  requestDetails: {
    marginTop: 10,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailText: {
    marginLeft: 10,
    color: '#333',
    flex: 1,
  },
  mapContainer: {
    height: 200,
    margin: 15,
    borderRadius: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
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
  driverCard: {
    backgroundColor: '#fff',
    margin: 15,
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  driverTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  driverInfo: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  driverAvatar: {
    marginRight: 15,
    justifyContent: 'center',
  },
  driverDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  driverName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  callButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  callButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
    margin: 15,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
  },
  cancelButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  newRequestButton: {
    backgroundColor: '#1e3c72',
    margin: 15,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
  },
  newRequestButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
  },
}); 