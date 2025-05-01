import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { auth, db } from './app/config/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function JobDetails() {
  const { requestId } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [jobDetails, setJobDetails] = useState(null);

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

    fetchJobDetails();
  }, [requestId]);

  const fetchJobDetails = async () => {
    try {
      const jobDoc = await getDoc(doc(db, 'towRequests', requestId));
      
      if (!jobDoc.exists()) {
        Alert.alert('Error', 'Job not found');
        router.back();
        return;
      }

      const data = jobDoc.data();
      
      // Verify this job belongs to the current driver
      if (data.driverId !== auth.currentUser.uid) {
        Alert.alert('Error', 'You do not have permission to view this job');
        router.back();
        return;
      }

      setJobDetails(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching job details:', error);
      Alert.alert('Error', 'Failed to load job details');
      router.back();
    }
  };

  const handleShare = async () => {
    try {
      const message = `Job Summary\n
Date: ${jobDetails.completedAt?.toDate().toLocaleDateString()}\n
Customer: ${jobDetails.userName}\n
Vehicle: ${jobDetails.vehicleType}\n
Status: ${jobDetails.status.charAt(0).toUpperCase() + jobDetails.status.slice(1)}\n
Location: ${jobDetails.address}\n`;

      await Share.share({
        message,
        title: 'Job Details'
      });
    } catch (error) {
      console.error('Error sharing job details:', error);
      Alert.alert('Error', 'Failed to share job details');
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

  // Calculate job duration
  let duration = 'N/A';
  if (jobDetails.status === 'completed' && jobDetails.arrivedAt && jobDetails.completedAt) {
    const arrivalTime = jobDetails.arrivedAt.toDate();
    const completionTime = jobDetails.completedAt.toDate();
    const durationMs = completionTime - arrivalTime;
    const durationMinutes = Math.floor(durationMs / 60000);
    
    if (durationMinutes < 60) {
      duration = `${durationMinutes} minutes`;
    } else {
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      duration = `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
  }

  // Calculate earnings
  const baseRate = 50; // $50 base fee
  const perKmRate = 2.5; // $2.50 per km
  let earnings = 'N/A';
  
  if (jobDetails.status === 'completed') {
    let totalAmount = baseRate;
    
    // Add distance-based fee if available
    if (jobDetails.distance) {
      totalAmount += jobDetails.distance * perKmRate;
    }
    
    earnings = `${totalAmount.toFixed(2)}`;
  }

  return (
    <View style={styles.container}>
      <LinearGradient 
        colors={['#1e3c72', '#2a5298']} 
        style={styles.headerContainer}
      >
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.push('/(driver)/history')}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Details</Text>
          <TouchableOpacity 
            style={styles.shareButton}
            onPress={handleShare}
          >
            <Ionicons name="share-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollContainer}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={[
              styles.statusBadge,
              jobDetails.status === 'completed' ? styles.completedBadge : styles.cancelledBadge
            ]}>
              <Text style={styles.statusText}>
                {jobDetails.status === 'completed' ? 'Completed' : 'Cancelled'}
              </Text>
            </View>
            <Text style={styles.jobId}>ID: {requestId.substring(0, 8)}...</Text>
          </View>

          <View style={styles.timelineContainer}>
            <View style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineLabel}>Request Received</Text>
                <Text style={styles.timelineTime}>
                  {jobDetails.createdAt?.toDate().toLocaleString()}
                </Text>
              </View>
            </View>

            {jobDetails.arrivedAt && (
              <View style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineLabel}>Arrived at Pickup</Text>
                  <Text style={styles.timelineTime}>
                    {jobDetails.arrivedAt.toDate().toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            {jobDetails.towStartedAt && (
              <View style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineLabel}>Towing Started</Text>
                  <Text style={styles.timelineTime}>
                    {jobDetails.towStartedAt.toDate().toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            {jobDetails.completedAt && (
              <View style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineLabel}>Job Completed</Text>
                  <Text style={styles.timelineTime}>
                    {jobDetails.completedAt.toDate().toLocaleString()}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Customer Information</Text>
          
          <View style={styles.customerInfo}>
            <View style={styles.customerAvatar}>
              <Ionicons name="person-circle" size={48} color="#1e3c72" />
            </View>
            <View style={styles.customerDetails}>
              <Text style={styles.customerName}>
                {jobDetails.userName || 'Customer'}
              </Text>
              <Text style={styles.vehicleInfo}>
                {jobDetails.vehicleType || 'Vehicle not specified'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Job Information</Text>
          
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={20} color="#1e3c72" />
            <Text style={styles.infoLabel}>Duration:</Text>
            <Text style={styles.infoValue}>{duration}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="cash-outline" size={20} color="#1e3c72" />
            <Text style={styles.infoLabel}>Earnings:</Text>
            <Text style={styles.infoValue}>&#8358;{earnings}</Text>
          </View>
          
          {jobDetails.distance && (
            <View style={styles.infoRow}>
              <Ionicons name="navigate-outline" size={20} color="#1e3c72" />
              <Text style={styles.infoLabel}>Distance:</Text>
              <Text style={styles.infoValue}>{jobDetails.distance.toFixed(1)} km</Text>
            </View>
          )}
          
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={20} color="#1e3c72" />
            <Text style={styles.infoLabel}>Location:</Text>
            <Text style={styles.infoValue}>{jobDetails.address || 'Address not available'}</Text>
          </View>
        </View>

        {jobDetails.location && (
          <View style={styles.mapCard}>
            <Text style={styles.cardTitle}>Pickup Location</Text>
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                initialRegion={{
                  latitude: jobDetails.location.latitude,
                  longitude: jobDetails.location.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                scrollEnabled={false}
                zoomEnabled={false}
              >
                <Marker
                  coordinate={{
                    latitude: jobDetails.location.latitude,
                    longitude: jobDetails.location.longitude,
                  }}
                  title="Pickup Location"
                  description={jobDetails.address || "Customer's location"}
                />
              </MapView>
            </View>
          </View>
        )}

        {jobDetails.description && (
          <View style={styles.detailsCard}>
            <Text style={styles.cardTitle}>Additional Notes</Text>
            <Text style={styles.description}>
              {jobDetails.description}
            </Text>
          </View>
        )}

        {jobDetails.status === 'cancelled' && jobDetails.cancellationReason && (
          <View style={[styles.detailsCard, styles.cancellationCard]}>
            <Text style={styles.cardTitle}>Cancellation Details</Text>
            <Text style={styles.cancellationReason}>
              Cancelled by: {jobDetails.cancelledBy || 'Unknown'}
            </Text>
            <Text style={styles.cancellationReason}>
              Reason: {jobDetails.cancellationReason}
            </Text>
          </View>
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
  centerContainer: {
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
  shareButton: {
    padding: 5,
  },
  scrollContainer: {
    flex: 1,
    padding: 15,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  completedBadge: {
    backgroundColor: '#2ecc71',
  },
  cancelledBadge: {
    backgroundColor: '#e74c3c',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  jobId: {
    fontSize: 12,
    color: '#666',
  },
  timelineContainer: {
    marginTop: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1e3c72',
    marginTop: 5,
    marginRight: 10,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  timelineTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
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
  },
  vehicleInfo: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 14,
    color: '#555',
    marginLeft: 10,
    width: 80,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  mapCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  mapContainer: {
    height: 200,
    borderRadius: 10,
    overflow: 'hidden',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  description: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  cancellationCard: {
    borderColor: '#e74c3c',
    borderWidth: 1,
  },
  cancellationReason: {
    fontSize: 14,
    color: '#e74c3c',
    marginBottom: 5,
  },
}); 