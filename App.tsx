
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import FloatingLoginBtn from './components/FloatingLoginBtn';
import OnboardingModal from './components/OnboardingModal';
import Home from './pages/Home';
import Events from './pages/Events';
import EventDetails from './pages/EventDetails';
import Gallery from './pages/Gallery';
import Components from './pages/Components';
import Print3D from './pages/Print3D';
import PcbOrderPage from './pages/PcbOrder';
import ModelViewer from './pages/ModelViewer';
import { UserDashboard } from './pages/UserDashboard';
import { Login } from './pages/Login';
import StaffLogin from './pages/StaffLogin';
import StaffDashboard from './pages/StaffDashboard';
import GoogleCallback from './pages/GoogleCallback';
import MicrosoftCallback from './pages/MicrosoftCallback';
import CompleteProfile from './pages/CompleteProfile';
import About from './pages/About';
import Team from './pages/Team';
import Projects from './pages/Projects';
import ProjectDetails from './pages/ProjectDetails';
import Resources from './pages/Resources';
import Testimonials from './pages/Testimonials';

import { User, StaffUser } from './types';
import { authService } from './services/api';
import { Loader2 } from 'lucide-react';

const Analytics = () => null;

const ScrollToTop = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

// Protected Route Component for Students
const ProtectedRoute = ({ isAllowed, children }: { isAllowed: boolean; children?: React.ReactNode }) => {
  if (!isAllowed) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// Protected Route Component for Staff
const StaffRoute = ({ isAllowed, children }: { isAllowed: boolean; children?: React.ReactNode }) => {
  if (!isAllowed) {
    return <Navigate to="/staff-login" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for active session on mount
  useEffect(() => {
    const initAuth = async () => {
      const { user, staff } = await authService.getCurrentSession();
      if (user) setUser(user);
      if (staff) setStaffUser(staff);
      setLoading(false);
    };
    initAuth();
  }, []);

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setStaffUser(null);
  };

  const handleProfileComplete = async (updatedUser: User) => {
    const savedUser = await authService.updateProfile(updatedUser);
    setUser(savedUser);
  };

  const handleUserUpdate = async (data: { name: string; avatar: string }) => {
    if (staffUser) {
      const updatedStaff = { ...staffUser, ...data };
      await authService.updateStaffProfile(updatedStaff);
      setStaffUser(updatedStaff);
    } else if (user) {
      const updatedUser = { ...user, ...data };
      await authService.updateProfile(updatedUser);
      setUser(updatedUser);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 text-brand-600 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Initializing Lab...</p>
      </div>
    );
  }

  return (
    <Router>
      <ScrollToTop />
      <div className="flex flex-col min-h-screen relative">
        <Navbar 
          user={user} 
          staffUser={staffUser} 
          onLogout={handleLogout} 
          onUpdateUser={handleUserUpdate}
        />
        
        {/* Onboarding Overlay for New Users */}
        {user && !user.isProfileComplete && (
           <OnboardingModal user={user} onComplete={handleProfileComplete} />
        )}

        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/events" element={<Events user={user || undefined} />} />
            <Route path="/events/:id" element={<EventDetails />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/about" element={<About />} />
            <Route path="/team" element={<Team />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetails />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/testimonials" element={<Testimonials />} />
            
            {/* Student Login */}
            <Route 
              path="/login" 
              element={
                user ? <Navigate to="/dashboard" /> : <Login onLogin={(u) => setUser(u)} />
              } 
            />

            {/* OAuth Callbacks */}
            <Route 
              path="/auth/google/callback" 
              element={<GoogleCallback onLogin={(u) => setUser(u)} />}
            />
            <Route 
              path="/auth/microsoft/callback" 
              element={<MicrosoftCallback onLogin={(u) => setUser(u)} />}
            />

            {/* Profile Completion */}
            <Route 
              path="/complete-profile" 
              element={<CompleteProfile onProfileComplete={handleProfileComplete} />}
            />
            
            {/* Staff Login */}
            <Route 
              path="/staff-login" 
              element={
                staffUser ? <Navigate to="/staff-dashboard" /> : <StaffLogin onLogin={(s) => setStaffUser(s)} />
              } 
            />

            {/* Protected Routes */}
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute isAllowed={!!user}>
                  <UserDashboard user={user || undefined} />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/components" 
              element={
                <ProtectedRoute isAllowed={!!user}>
                  <Components user={user || undefined} />
                </ProtectedRoute>
              } 
            />
            <Route
              path="/3d-print"
              element={
                <ProtectedRoute isAllowed={!!user}>
                  <Print3D user={user || undefined} />
                </ProtectedRoute>
              }
            />
            <Route
              path="/model-viewer"
              element={
                <ProtectedRoute isAllowed={!!user}>
                  <ModelViewer />
                </ProtectedRoute>
              }
            />
            <Route 
              path="/pcb-order" 
              element={
                <ProtectedRoute isAllowed={!!user}>
                  <PcbOrderPage user={user || undefined} />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/staff-dashboard" 
              element={
                <StaffRoute isAllowed={!!staffUser}>
                  <StaffDashboard />
                </StaffRoute>
              } 
            />
          </Routes>
        </main>
        <Footer />
        
        {/* Analytics for Vercel */}
        <Analytics />
        
        {/* Only show floating btn if no one is logged in */}
        {!user && !staffUser && <FloatingLoginBtn />}
      </div>
    </Router>
  );
};

export default App;
