import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
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
  orderBy, 
  getDocs,
  limit,
  startAfter
} from 'firebase/firestore';

export default function DriverHistory() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('all'); // 'all', 'completed', 'cancelled'
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisible, setLastVisible] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [noMoreJobs, setNoMoreJobs] = useState(false);

  useEffect(() => {
    // Check if driver is authenticated
    if (!auth.currentUser) {
      router.replace('/(auth)/driver-login');
      return;
    }

    fetchHistory();
  }, [selectedFilter]);

  const fetchHistory = async (isRefreshing = false) => {
    try {
      if (isRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setNoMoreJobs(false);
      
      const driverId = auth.currentUser.uid;
      let historyQuery;

      // Create the base query
      const baseQuery = collection(db, 'towRequests');
      
      if (selectedFilter === 'all') {
        historyQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', 'in', ['completed', 'cancelled']),
          orderBy('updatedAt', 'desc'),
          limit(10)
        );
      } else if (selectedFilter === 'completed') {
        historyQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', '==', 'completed'),
          orderBy('updatedAt', 'desc'),
          limit(10)
        );
      } else if (selectedFilter === 'cancelled') {
        historyQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', '==', 'cancelled'),
          orderBy('updatedAt', 'desc'),
          limit(10)
        );
      }

      const querySnapshot = await getDocs(historyQuery);
      
      if (querySnapshot.empty) {
        setHistory([]);
        setNoMoreJobs(true);
      } else {
        const historyData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        setHistory(historyData);
        setLastVisible(querySnapshot.docs[querySnapshot.docs.length - 1]);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      Alert.alert('Error', 'Failed to load job history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchMoreHistory = async () => {
    if (loadingMore || noMoreJobs) return;

    try {
      setLoadingMore(true);
      const driverId = auth.currentUser.uid;
      let moreHistoryQuery;

      // Create the base query
      const baseQuery = collection(db, 'towRequests');
      
      if (selectedFilter === 'all') {
        moreHistoryQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', 'in', ['completed', 'cancelled']),
          orderBy('updatedAt', 'desc'),
          limit(10),
          ...(lastVisible ? [startAfter(lastVisible)] : [])
        );
      } else if (selectedFilter === 'completed') {
        moreHistoryQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', '==', 'completed'),
          orderBy('updatedAt', 'desc'),
          limit(10),
          ...(lastVisible ? [startAfter(lastVisible)] : [])
        );
      } else if (selectedFilter === 'cancelled') {
        moreHistoryQuery = query(
          baseQuery,
          where('driverId', '==', driverId),
          where('status', '==', 'cancelled'),
          orderBy('updatedAt', 'desc'),
          limit(10),
          ...(lastVisible ? [startAfter(lastVisible)] : [])
        );
      }

      const querySnapshot = await getDocs(moreHistoryQuery);
      
      if (querySnapshot.empty) {
        setNoMoreJobs(true);
      } else {
        const moreHistoryData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        setHistory([...history, ...moreHistoryData]);
        setLastVisible(querySnapshot.docs[querySnapshot.docs.length - 1]);
      }
    } catch (error) {
      console.error('Error fetching more history:', error);
      Alert.alert('Error', 'Failed to load more jobs');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRefresh = () => {
    fetchHistory(true);
  };

  const renderHistoryItem = ({ item }) => {
    const date = item.updatedAt?.toDate 
      ? item.updatedAt.toDate() 
      : new Date();
      
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    
    const formattedTime = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Calculate job duration if available
    let duration = 'N/A';
    if (item.status === 'completed' && item.arrivedAt && item.completedAt) {
      const arrivalTime = item.arrivedAt.toDate();
      const completionTime = item.completedAt.toDate();
      const durationMs = completionTime - arrivalTime;
      const durationMinutes = Math.floor(durationMs / 60000);
      
      if (durationMinutes < 60) {
        duration = `${durationMinutes} min`;
      } else {
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        duration = `${hours}h ${minutes}m`;
      }
    }
    
    // Calculate estimated earnings (simple model)
    const baseRate = 50; // $50 base fee
    const perKmRate = 2.5; // $2.50 per km
    let earnings = 'N/A';
    
    if (item.status === 'completed') {
      let totalAmount = baseRate;
      
      // Add distance-based fee if available
      if (item.distance) {
        totalAmount += item.distance * perKmRate;
      }
      
      earnings = `${totalAmount.toFixed(2)}`;
    }

    return (
      <TouchableOpacity 
        style={styles.historyItem}
        onPress={() => router.push({
          pathname: '/(driver)/_job-details',
          params: { requestId: item.id }
        })}
      >
        <View style={styles.historyItemHeader}>
          <View style={styles.dateTimeContainer}>
            <Text style={styles.dateText}>{formattedDate}</Text>
            <Text style={styles.timeText}>{formattedTime}</Text>
          </View>
          <View style={[
            styles.statusBadge,
            item.status === 'completed' ? styles.completedBadge : styles.cancelledBadge
          ]}>
            <Text style={styles.statusText}>
              {item.status === 'completed' ? 'Completed' : 'Cancelled'}
            </Text>
          </View>
        </View>
        
        <View style={styles.customerInfo}>
          <View style={styles.customerAvatar}>
            <Ionicons name="person-circle" size={36} color="#1e3c72" />
          </View>
          <View style={styles.customerDetails}>
            <Text style={styles.customerName}>
              {item.userName || 'Customer'}
            </Text>
            <Text style={styles.vehicleInfo}>
              {item.vehicleType || 'Vehicle'}
            </Text>
          </View>
        </View>

        <View style={styles.jobDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="cash-outline" size={16} color="#4CAF50" />
            <Text style={styles.detailLabel}>Earnings:</Text>
            <Text style={styles.detailValue}>&#8358;{earnings}</Text>
          </View>
          
          <View style={styles.detailItem}>
            <Ionicons name="time-outline" size={16} color="#3498db" />
            <Text style={styles.detailLabel}>Duration:</Text>
            <Text style={styles.detailValue}>{duration}</Text>
          </View>
          
          <View style={styles.detailItem}>
            <Ionicons name="location-outline" size={16} color="#9b59b6" />
            <Text style={styles.detailLabel}>Location:</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {item.address || 'Location unavailable'}
            </Text>
          </View>
        </View>
        
        <View style={styles.viewDetailsContainer}>
          <Text style={styles.viewDetailsText}>View Details</Text>
          <Ionicons name="chevron-forward" size={16} color="#1e3c72" />
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="document-text-outline" size={80} color="#ccc" />
      <Text style={styles.emptyTitle}>No jobs found</Text>
      <Text style={styles.emptyText}>
        Your completed and cancelled jobs will appear here
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#1e3c72" />
        <Text style={styles.footerText}>Loading more jobs...</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#4a1259', '#7c2ab9']} style={styles.headerContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Job History</Text>
        </View>
      </LinearGradient>

      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[
            styles.filterButton,
            selectedFilter === 'all' && styles.filterButtonActive
          ]}
          onPress={() => setSelectedFilter('all')}
        >
          <Text style={[
            styles.filterButtonText,
            selectedFilter === 'all' && styles.filterButtonTextActive
          ]}>All</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.filterButton,
            selectedFilter === 'completed' && styles.filterButtonActive
          ]}
          onPress={() => setSelectedFilter('completed')}
        >
          <Text style={[
            styles.filterButtonText,
            selectedFilter === 'completed' && styles.filterButtonTextActive
          ]}>Completed</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.filterButton,
            selectedFilter === 'cancelled' && styles.filterButtonActive
          ]}
          onPress={() => setSelectedFilter('cancelled')}
        >
          <Text style={[
            styles.filterButtonText,
            selectedFilter === 'cancelled' && styles.filterButtonTextActive
          ]}>Cancelled</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1e3c72" />
          <Text style={styles.loadingText}>Loading job history...</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          renderItem={renderHistoryItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onEndReached={fetchMoreHistory}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={renderEmptyList}
          ListFooterComponent={renderFooter}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerContainer: {
    paddingTop: 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eaeaea',
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginHorizontal: 5,
    backgroundColor: 'rgba(74, 18, 89, 0.1)',
  },
  filterButtonActive: {
    backgroundColor: '#4a1259',
  },
  filterButtonText: {
    color: '#4a1259',
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  loadingContainer: {
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
  listContent: {
    padding: 15,
    paddingBottom: 30,
  },
  historyItem: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    marginHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dateTimeContainer: {
    flexDirection: 'column',
  },
  dateText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  timeText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  completedBadge: {
    backgroundColor: '#4a1259',
  },
  cancelledBadge: {
    backgroundColor: '#ff6b6b',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  customerAvatar: {
    marginRight: 10,
  },
  customerDetails: {
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4a1259',
    marginBottom: 4,
  },
  vehicleInfo: {
    fontSize: 14,
    color: '#666',
  },
  jobDetails: {
    marginBottom: 10,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  detailLabel: {
    fontSize: 14,
    color: '#555',
    marginLeft: 5,
    marginRight: 5,
    width: 70,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  viewDetailsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 5,
  },
  viewDetailsText: {
    fontSize: 14,
    color: '#1e3c72',
    fontWeight: 'bold',
    marginRight: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    marginTop: 50,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  footerText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#666',
  },
}); 