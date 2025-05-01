import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Linking,
  Platform
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { 
  doc, 
  getDoc, 
  updateDoc, 
  onSnapshot,
  serverTimestamp,
  increment,
  runTransaction
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
  // Assume average speed of 30 km/h for city traffic
  const timeInHours = distanceInKm / 30;
  const timeInMinutes = Math.round(timeInHours * 60);
  return Math.max(5, timeInMinutes); // Minimum 5 minutes
};

export default function ActiveJob() {
  const { requestId } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [distance, setDistance] = useState(null);
  const [eta, setEta] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [jobStatus, setJobStatus] = useState('heading_to_pickup'); // can be heading_to_pickup, arrived_at_pickup, towing_in_progress, completed
  const mapRef = useRef(null);

  useEffect(() => {
    // Check if driver is authenticated
    if (!auth.currentUser) {
      router.replace('/(auth)/driver-login');
      return;
    }

    if (!requestId) {
      Alert.alert('Error', 'No request ID provided');
      router.back();
      return;
    }

    // Request location permissions and start location updates
    requestLocationPermission();

    // Listen for updates to the request
    const requestUnsub = onSnapshot(
      doc(db, 'towRequests', requestId),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setRequest(data);
          
          // Update job status based on request status
          if (data.status === 'accepted') {
            setJobStatus('heading_to_pickup');
          } else if (data.status === 'arrived_at_pickup') {
            setJobStatus('arrived_at_pickup');
          } else if (data.status === 'in_progress') {
            setJobStatus('towing_in_progress');
          } else if (data.status === 'completed') {
            setJobStatus('completed');
          }

          setLoading(false);
        } else {
          Alert.alert('Error', 'Request not found');
          router.back();
        }
      },
      (error) => {
        console.error('Error getting request:', error);
        Alert.alert('Error', 'Failed to get request details');
        router.back();
      }
    );

    // Setup location updates
    const locationInterval = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });

        const newLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: LATITUDE_DELTA,
          longitudeDelta: LONGITUDE_DELTA,
        };

        setCurrentLocation(newLocation);

        // Update distance and ETA if we have request data
        if (request?.location) {
          const dist = calculateDistance(
            newLocation.latitude,
            newLocation.longitude,
            request.location.latitude,
            request.location.longitude
          );
          setDistance(dist);
          setEta(calculateETA(dist));
        }

        // Update driver's location in Firestore
        if (auth.currentUser) {
          await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
            currentLocation: {
              latitude: newLocation.latitude,
              longitude: newLocation.longitude
            },
            lastLocationUpdate: serverTimestamp()
          });

          // Update driver location in request
          await updateDoc(doc(db, 'towRequests', requestId), {
            driverLocation: {
              latitude: newLocation.latitude,
              longitude: newLocation.longitude
            },
            updatedAt: serverTimestamp()
          });
        }
      } catch (error) {
        console.error('Error updating location:', error);
      }
    }, 10000); // Update every 10 seconds

    // Cleanup
    return () => {
      requestUnsub();
      clearInterval(locationInterval);
    };
  }, [requestId]);

  // Update distance and ETA when location or request changes
  useEffect(() => {
    if (currentLocation && request?.location) {
      const dist = calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        request.location.latitude,
        request.location.longitude
      );
      setDistance(dist);
      setEta(calculateETA(dist));
    }
  }, [currentLocation, request]);

  const requestLocationPermission = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for this feature');
        return;
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
      
      // Update distance and ETA if we have request data
      if (request?.location) {
        const dist = calculateDistance(
          newLocation.latitude,
          newLocation.longitude,
          request.location.latitude,
          request.location.longitude
        );
        setDistance(dist);
        setEta(calculateETA(dist));
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const handleOpenMaps = () => {
    if (!request?.location) return;
    
    const { latitude, longitude } = request.location;
    const label = 'Pickup Location';
    
    const url = Platform.select({
      ios: `maps:0,0?q=${label}@${latitude},${longitude}`,
      android: `geo:0,0?q=${latitude},${longitude}(${label})`
    });
    
    Linking.openURL(url);
  };

  const handleStatusUpdate = async (newStatus) => {
    try {
      let updates = {
        status: newStatus,
        updatedAt: serverTimestamp()
      };

      // Add specific fields based on the status change
      if (newStatus === 'arrived_at_pickup') {
        updates.arrivedAt = serverTimestamp();
        // Update driver's status to indicate they're at pickup
        await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
          status: 'at_pickup',
          updatedAt: serverTimestamp()
        });
      } else if (newStatus === 'in_progress') {
        updates.towStartedAt = serverTimestamp();
        // Update driver's status to indicate they're towing
        await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
          status: 'towing',
          updatedAt: serverTimestamp()
        });
      } else if (newStatus === 'completed') {
        // Use a transaction to ensure all updates are atomic
        await runTransaction(db, async (transaction) => {
          // Get the current request data
          const requestRef = doc(db, 'towRequests', requestId);
          const requestDoc = await transaction.get(requestRef);
          if (!requestDoc.exists()) {
            throw new Error('Request does not exist!');
          }

          const requestData = requestDoc.data();
          
          // Calculate job duration and earnings
          const arrivalTime = requestData.arrivedAt?.toDate() || new Date();
          const completionTime = new Date();
          const durationMs = completionTime - arrivalTime;
          const durationMinutes = Math.round(durationMs / 60000);

          // Calculate earnings
          const baseRate = 50; // $50 base fee
          const perKmRate = 2.5; // $2.50 per km
          const distanceCharge = (requestData.distance || 0) * perKmRate;
          const totalEarnings = baseRate + distanceCharge;

          // Update request document
          transaction.update(requestRef, {
            ...updates,
            completedAt: serverTimestamp(),
            duration: durationMinutes,
            earnings: totalEarnings,
            baseRate: baseRate,
            distanceCharge: distanceCharge
          });

          // Update driver document
          const driverRef = doc(db, 'drivers', auth.currentUser.uid);
          transaction.update(driverRef, {
            isAvailable: true,
            status: 'available',
            activeRequestId: null,
            totalRides: increment(1),
            totalEarnings: increment(totalEarnings),
            updatedAt: serverTimestamp()
          });

          // Update user document
          const userRef = doc(db, 'users', requestData.userId);
          transaction.update(userRef, {
            totalRides: increment(1),
            updatedAt: serverTimestamp()
          });
        });

        // Show success message and navigate
        setTimeout(() => {
          Alert.alert('Success', 'Job completed successfully!', [
            { text: 'OK', onPress: () => router.replace('/(driver)/home') }
          ]);
        }, 1000);
      }

      // If not completed (for arrived_at_pickup and in_progress), update request directly
      if (newStatus !== 'completed') {
        await updateDoc(doc(db, 'towRequests', requestId), updates);
      }

      setJobStatus(
        newStatus === 'arrived_at_pickup' ? 'arrived_at_pickup' :
        newStatus === 'in_progress' ? 'towing_in_progress' :
        newStatus === 'completed' ? 'completed' : 'heading_to_pickup'
      );
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'Failed to update job status');
    }
  };

  const handleCallCustomer = () => {
    if (!request?.userPhone) {
      Alert.alert('Error', 'Customer phone number not available');
      return;
    }

    Linking.openURL(`tel:${request.userPhone}`);
  };

  const handleCancelJob = () => {
    Alert.alert(
      'Cancel Job',
      'Are you sure you want to cancel this job? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        { 
          text: 'Yes, Cancel', 
          style: 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'towRequests', requestId), {
                status: 'cancelled',
                cancelledBy: 'driver',
                cancellationReason: 'Driver cancelled',
                updatedAt: serverTimestamp()
              });

              await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
                isAvailable: true,
                activeRequestId: null,
                updatedAt: serverTimestamp()
              });

              Alert.alert('Job Cancelled', 'You have cancelled this job', [
                { text: 'OK', onPress: () => router.replace('/(driver)/home') }
              ]);
            } catch (error) {
              console.error('Error cancelling job:', error);
              Alert.alert('Error', 'Failed to cancel job');
            }
          }
        }
      ]
    );
  };

  const handleMapReady = () => {
    setMapReady(true);
    
    if (mapRef.current && currentLocation && request?.location) {
      // Fit to markers
      mapRef.current.fitToCoordinates(
        [
          {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude
          },
          {
            latitude: request.location.latitude,
            longitude: request.location.longitude
          }
        ],
        {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true
        }
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Loading job details...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#4a1259', '#7c2ab9']} style={styles.headerContainer}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Active Job</Text>
          <View style={styles.spacer} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollContainer}>
        <View style={styles.mapContainer}>
          {currentLocation && request?.location && (
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={currentLocation}
              onMapReady={handleMapReady}
            >
              <Marker
                coordinate={{
                  latitude: currentLocation.latitude,
                  longitude: currentLocation.longitude,
                }}
                title="Your Location"
                description="You are here"
              >
                <View style={styles.driverMarker}>
                  <Ionicons name="car" size={20} color="#fff" />
                </View>
              </Marker>
              
              <Marker
                coordinate={{
                  latitude: request.location.latitude,
                  longitude: request.location.longitude,
                }}
                title="Pickup Location"
                description={request.address || "Customer's location"}
                pinColor="#e74c3c"
              />
              
              {/* Simple straight line between points */}
              <Polyline
                coordinates={[
                  {
                    latitude: currentLocation.latitude,
                    longitude: currentLocation.longitude
                  },
                  {
                    latitude: request.location.latitude,
                    longitude: request.location.longitude
                  }
                ]}
                strokeColor="#1e3c72"
                strokeWidth={3}
                lineDashPattern={[1]}
              />
            </MapView>
          )}
          
          <TouchableOpacity 
            style={styles.directionsButton}
            onPress={handleOpenMaps}
          >
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.directionsText}>Directions</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoContainer}>
          <View style={styles.statusContainer}>
            <Text style={styles.statusLabel}>Status:</Text>
            <View style={[
              styles.statusBadge,
              jobStatus === 'heading_to_pickup' ? styles.statusHeading :
              jobStatus === 'arrived_at_pickup' ? styles.statusArrived :
              jobStatus === 'towing_in_progress' ? styles.statusTowing :
              styles.statusCompleted
            ]}>
              <Text style={styles.statusText}>
                {jobStatus === 'heading_to_pickup' ? 'Heading to Pickup' :
                 jobStatus === 'arrived_at_pickup' ? 'Arrived at Pickup' :
                 jobStatus === 'towing_in_progress' ? 'Towing in Progress' :
                 'Completed'}
              </Text>
            </View>
          </View>

          <View style={styles.locationInfo}>
            <View style={styles.distanceContainer}>
              <Ionicons name="locate-outline" size={22} color="#1e3c72" />
              <View>
                <Text style={styles.distanceLabel}>Distance</Text>
                <Text style={styles.distanceValue}>
                  {distance ? `${distance.toFixed(1)} km` : 'Calculating...'}
                </Text>
              </View>
            </View>
            
            <View style={styles.etaContainer}>
              <Ionicons name="time-outline" size={22} color="#1e3c72" />
              <View>
                <Text style={styles.etaLabel}>ETA</Text>
                <Text style={styles.etaValue}>
                  {eta ? `${eta} min` : 'Calculating...'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.customerInfoCard}>
            <Text style={styles.cardTitle}>Customer Details</Text>
            
            <View style={styles.customerInfo}>
              <View style={styles.customerAvatar}>
                <Ionicons name="person-circle" size={48} color="#1e3c72" />
              </View>
              <View style={styles.customerDetails}>
                <Text style={styles.customerName}>
                  {request.userName || 'Customer'}
                </Text>
                <TouchableOpacity 
                  style={styles.phoneContainer}
                  onPress={handleCallCustomer}
                >
                  <Ionicons name="call-outline" size={16} color="#4CAF50" />
                  <Text style={styles.phoneNumber}>
                    {request.userPhone || 'No phone number available'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.requestDetailsCard}>
            <Text style={styles.cardTitle}>Request Details</Text>
            
            <View style={styles.detailRow}>
              <Ionicons name="car-outline" size={18} color="#555" />
              <Text style={styles.detailLabel}>Vehicle:</Text>
              <Text style={styles.detailValue}>{request.vehicleType || 'Not specified'}</Text>
            </View>
            
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={18} color="#555" />
              <Text style={styles.detailLabel}>Address:</Text>
              <Text style={styles.detailValue} numberOfLines={2}>
                {request.address || 'Location on map'}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Ionicons name="information-circle-outline" size={18} color="#555" />
              <Text style={styles.detailLabel}>Notes:</Text>
              <Text style={styles.detailValue} numberOfLines={3}>
                {request.description || 'No additional information provided'}
              </Text>
            </View>
            
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={18} color="#555" />
              <Text style={styles.detailLabel}>Requested:</Text>
              <Text style={styles.detailValue}>
                {request.createdAt?.toDate 
                  ? request.createdAt.toDate().toLocaleString() 
                  : 'Just now'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.actionsContainer}>
        {jobStatus === 'heading_to_pickup' && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleStatusUpdate('arrived_at_pickup')}
          >
            <Text style={styles.actionButtonText}>I've Arrived at Pickup</Text>
          </TouchableOpacity>
        )}
        
        {jobStatus === 'arrived_at_pickup' && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleStatusUpdate('in_progress')}
          >
            <Text style={styles.actionButtonText}>Start Towing</Text>
          </TouchableOpacity>
        )}
        
        {jobStatus === 'towing_in_progress' && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleStatusUpdate('completed')}
          >
            <Text style={styles.actionButtonText}>Complete Job</Text>
          </TouchableOpacity>
        )}
        
        {jobStatus !== 'completed' && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancelJob}
          >
            <Text style={styles.cancelButtonText}>Cancel Job</Text>
          </TouchableOpacity>
        )}
      </View>
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
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  spacer: {
    width: 24,
  },
  scrollContainer: {
    flex: 1,
  },
  mapContainer: {
    height: 250,
    width: '100%',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  directionsButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: '#4a1259',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  directionsText: {
    color: '#fff',
    marginLeft: 5,
    fontWeight: 'bold',
  },
  driverMarker: {
    backgroundColor: '#4a1259',
    borderRadius: 15,
    padding: 5,
  },
  infoContainer: {
    padding: 20,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  statusLabel: {
    fontSize: 16,
    color: '#555',
    marginRight: 10,
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  statusHeading: {
    backgroundColor: '#f39c12',
  },
  statusArrived: {
    backgroundColor: '#4a1259',
  },
  statusTowing: {
    backgroundColor: '#7c2ab9',
  },
  statusCompleted: {
    backgroundColor: '#2ecc71',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  locationInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  distanceLabel: {
    fontSize: 12,
    color: '#666',
    marginLeft: 5,
  },
  distanceValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 5,
  },
  etaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  etaLabel: {
    fontSize: 12,
    color: '#666',
    marginLeft: 5,
  },
  etaValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 5,
  },
  customerInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e3c72',
    marginBottom: 15,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerAvatar: {
    marginRight: 15,
  },
  customerDetails: {
    flex: 1,
  },
  customerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  phoneNumber: {
    color: '#4CAF50',
    marginLeft: 5,
  },
  requestDetailsCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailLabel: {
    color: '#555',
    marginLeft: 5,
    marginRight: 5,
    width: 60,
  },
  detailValue: {
    color: '#333',
    flex: 1,
  },
  actionsContainer: {
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eaeaea',
  },
  actionButton: {
    backgroundColor: '#4a1259',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e74c3c',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#e74c3c',
    fontWeight: 'bold',
    fontSize: 16,
  },
}); 