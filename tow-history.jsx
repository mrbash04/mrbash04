import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs,
  Timestamp
} from 'firebase/firestore';

export default function TowHistory() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState([]);

  const fetchRequests = async () => {
    try {
      if (!auth.currentUser) {
        router.replace('/(auth)/user-login');
        return;
      }

      const userId = auth.currentUser.uid;
      
      // Using a simple query with only userId filter - no orderBy which requires a composite index
      const requestsQuery = query(
        collection(db, 'towRequests'),
        where('userId', '==', userId)
      );

      const querySnapshot = await getDocs(requestsQuery);
      
      // Process and sort the data in JavaScript instead of in the query
      const requestsData = querySnapshot.docs
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

      setRequests(requestsData);
    } catch (error) {
      console.error('Error fetching tow history:', error);
      Alert.alert('Error', 'Failed to load tow history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchRequests();
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute:'2-digit'
      });
    } catch (error) {
      console.error('Date formatting error:', error);
      return 'Invalid date';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return '#2ecc71';
      case 'cancelled':
        return '#e74c3c';
      case 'accepted':
        return '#3498db';
      default:
        return '#f39c12';
    }
  };

  const renderRequestItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.requestCard}
      onPress={() => router.push({
        pathname: '/(user)/request-status',
        params: { requestId: item.id }
      })}
    >
      <View style={styles.requestHeader}>
        <View style={styles.requestInfo}>
          <Text style={styles.requestDate}>{formatDate(item.createdAt)}</Text>
          <Text style={styles.requestVehicle}>{item.vehicleType || 'Vehicle'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{item.status || 'pending'}</Text>
        </View>
      </View>
      
      <Text style={styles.requestDescription} numberOfLines={2}>
        {item.description || 'No description provided'}
      </Text>

      <View style={styles.requestFooter}>
        <View style={styles.locationInfo}>
          <Ionicons name="location-outline" size={16} color="#666" />
          <Text style={styles.locationText}>
            {item.location ? `${item.location.latitude.toFixed(4)}, ${item.location.longitude.toFixed(4)}` : 'Location not available'}
          </Text>
        </View>
        {item.driverId && (
          <View style={styles.driverInfo}>
            <Ionicons name="person-outline" size={16} color="#666" />
            <Text style={styles.driverText}>Driver Assigned</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1e3c72', '#2a5298']} style={styles.headerContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Tow History</Text>
        </View>
      </LinearGradient>

      <FlatList
        data={requests}
        renderItem={renderRequestItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#1e3c72']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No tow history yet</Text>
            <TouchableOpacity
              style={styles.requestButton}
              onPress={() => router.push('/(user)/request-tow')}
            >
              <Text style={styles.requestButtonText}>Request a Tow</Text>
            </TouchableOpacity>
          </View>
        }
      />
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  listContainer: {
    padding: 20,
  },
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  requestInfo: {
    flex: 1,
  },
  requestDate: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  requestVehicle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  requestDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    marginLeft: 5,
    fontSize: 12,
    color: '#666',
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverText: {
    marginLeft: 5,
    fontSize: 12,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: '#555',
    marginTop: 20,
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
}); 