import { Text, View, StyleSheet, ImageBackground, TouchableOpacity, Dimensions } from 'react-native';
import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function Index() {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1e3c72', '#2a5298']}
        style={styles.gradient}
      >
        <View style={styles.logoContainer}>
          <Ionicons name="car" size={80} color="#fff" />
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.title}>TowTruck</Text>
          <Text style={styles.subtitle}>Your Roadside Assistant</Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button}>
            <Link href="/(auth)/user-login" style={styles.buttonText}>
              <Ionicons name="person" size={24} color="#fff" style={styles.buttonIcon} />
              User Login
            </Link>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.driverButton]}>
            <Link href="/(auth)/driver-login" style={styles.buttonText}>
              <Ionicons name="car-sport" size={24} color="#fff" style={styles.buttonIcon} />
              Driver Login
            </Link>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: '#rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    gap: 20,
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  driverButton: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 10,
  },
});
