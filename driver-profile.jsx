import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import { db, auth } from '../config/firebase';

export default function DriverProfile() {
  const { logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [editedProfile, setEditedProfile] = useState(null);
  const user = auth.currentUser;
  
  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/driver-login');
      return;
    }
    fetchDriverProfile();
  }, [user]);

  const fetchDriverProfile = async () => {
    try {
      const driverDoc = await getDoc(doc(db, 'drivers', user.uid));
      if (driverDoc.exists()) {
        setProfile(driverDoc.data());
        setEditedProfile(driverDoc.data());
      }
      setLoading(false);
    } catch (error) {
      console.error('Error fetching profile:', error);
      Alert.alert('Error', 'Failed to load profile data');
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setLoading(true);
      await updateDoc(doc(db, 'drivers', user.uid), editedProfile);
      setProfile(editedProfile);
      setEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              // Delete Firestore document
              await deleteDoc(doc(db, 'drivers', user.uid));
              // Delete Firebase Auth user
              await deleteUser(auth.currentUser);
              await logout();
              router.replace('/(auth)/driver-login');
            } catch (error) {
              console.error('Error deleting account:', error);
              Alert.alert('Error', 'Failed to delete account');
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              router.replace('/(auth)/driver-login');
            } catch (error) {
              console.error('Error logging out:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e3c72" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#4a1259', '#7c2ab9']} style={styles.headerContainer}>
        <View style={styles.header}>
          {/*<TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>*/}
          <Text style={styles.title}>Driver Profile</Text>
          <TouchableOpacity
            onPress={() => editing ? handleSaveProfile() : setEditing(true)}
            style={styles.editButton}
          >
            <Text style={styles.editButtonText}>
              {editing ? 'Save' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollView}>
        <View style={styles.profileContainer}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Ionicons name="car" size={60} color="#1e3c72" />
            </View>
            <Text style={styles.nameText}>{profile?.fullName}</Text>
            <Text style={styles.emailText}>{user?.email}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Personal Information</Text>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Full Name</Text>
              {editing ? (
                <TextInput
                  style={styles.input}
                  value={editedProfile?.fullName}
                  onChangeText={(text) => setEditedProfile({ ...editedProfile, fullName: text })}
                  placeholder="Enter full name"
                  placeholderTextColor="#999"
                />
              ) : (
                <Text style={styles.value}>{profile?.fullName}</Text>
              )}
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Phone Number</Text>
              {editing ? (
                <TextInput
                  style={styles.input}
                  value={editedProfile?.phone}
                  onChangeText={(text) => setEditedProfile({ ...editedProfile, phoneNumber: text })}
                  placeholder="Enter phone number"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                />
              ) : (
                <Text style={styles.value}>{profile?.phone}</Text>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Vehicle Information</Text>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Vehicle Model</Text>
              {editing ? (
                <TextInput
                  style={styles.input}
                  value={editedProfile?.vehicleModel}
                  onChangeText={(text) => setEditedProfile({ ...editedProfile, vehicleModel: text })}
                  placeholder="Enter vehicle model"
                  placeholderTextColor="#999"
                />
              ) : (
                <Text style={styles.value}>{profile?.vehicleModel}</Text>
              )}
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>License Plate</Text>
              {editing ? (
                <TextInput
                  style={styles.input}
                  value={editedProfile?.licensePlate}
                  onChangeText={(text) => setEditedProfile({ ...editedProfile, licensePlate: text })}
                  placeholder="Enter license plate"
                  placeholderTextColor="#999"
                />
              ) : (
                <Text style={styles.value}>{profile?.licensePlate}</Text>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Statistics</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile?.totalRides || 0}</Text>
                <Text style={styles.statLabel}>Total Rides</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile?.rating ? `${profile?.rating.toFixed(1)}` : 'N/A'}</Text>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>&#8358;{profile?.totalEarnings?.toFixed(2) || '0.00'}</Text>
                <Text style={styles.statLabel}>Total Earnings</Text>
              </View>
            </View>
          </View>

          {editing && (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setEditedProfile(profile);
                setEditing(false);
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={24} color="#fff" />
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDeleteAccount}
          >
            <Text style={styles.deleteButtonText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  backButton: {
    padding: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  editButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 8,
    borderRadius: 8,
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  profileContainer: {
    padding: 20,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  nameText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4a1259',
    marginBottom: 5,
  },
  emailText: {
    fontSize: 16,
    color: '#666',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#4a1259',
    marginBottom: 15,
  },
  infoRow: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  value: {
    fontSize: 16,
    color: '#333',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    color: '#333',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  statItem: {
    alignItems: 'center',
    width: '33%',
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
  cancelButton: {
    backgroundColor: '#f5f7fa',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  logoutButton: {
    backgroundColor: '#4a1259',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  deleteButton: {
    backgroundColor: '#ff6b6b',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
