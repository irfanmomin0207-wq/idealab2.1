
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Loader2, GraduationCap, Globe, Smartphone, KeyRound, ChevronLeft } from 'lucide-react';
import { authService } from '../services/api';
import { User as UserType } from '../types';

// Firebase OTP Imports
import { sendOTP } from '../src/services/sendOTP';
import { verifyOTP } from '../src/services/verifyOTP';
import { setupRecaptcha } from '../src/firebase';
import { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

interface LoginProps {
  onLogin: (user: UserType) => void;
}

const MicrosoftLogo = () => (
    <svg viewBox="0 0 21 21" width="21" height="21" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
        <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
        <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
        <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
);

const GoogleLogo = () => (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
);

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [step, setStep] = useState<'role' | 'method' | 'phone' | 'otp'>('role');
  const [selectedRole, setSelectedRole] = useState<'university' | 'non-university' | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); // General error message
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [recaptchaVerifier, setRecaptchaVerifier] = useState<RecaptchaVerifier | null>(null);
  
  const navigate = useNavigate();

  const handleRoleSelect = (role: 'university' | 'non-university') => {
    setSelectedRole(role);
    setStep('method');
    setError(null);
  };

  const handleOAuthLogin = async (provider: 'microsoft' | 'google') => {
      setLoading(true);
      setError(null);
      try {
          console.log(`Starting ${provider} login...`);
          if (provider === 'microsoft') {
              await authService.loginWithMicrosoft(selectedRole || 'university');
          } else {
              await authService.loginWithGoogle(selectedRole || 'non-university');
          }
          // If we reach here, something went wrong
          setError("OAuth redirect failed");
          setLoading(false);
      } catch (err: any) {
          console.error('OAuth error:', err);
          setError(err.message || `${provider} login failed. Make sure the redirect URI is configured in the OAuth console.`);
          setLoading(false);
      }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Fallback to mock OTP if Firebase is not configured with an API key
    if (!import.meta.env.VITE_FIREBASE_API_KEY) {
      try {
        await authService.sendOtp(`+91${phoneNumber}`);
        setStep('otp');
      } catch (err: any) {
        setError(err.message || "Failed to send OTP");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Ensure reCAPTCHA is set up before sending OTP
    if (!recaptchaVerifier) {
      try {
        const verifier = setupRecaptcha("recaptcha-container");
        setRecaptchaVerifier(verifier);
      } catch (err: any) {
        // If recaptcha setup fails (e.g. invalid config), fallback to mock OTP
        console.warn("reCAPTCHA setup failed, falling back to mock OTP:", err);
        try {
          await authService.sendOtp(`+91${phoneNumber}`);
          setStep('otp');
        } catch (mErr: any) {
          setError(mErr.message || "Failed to send OTP");
        } finally {
          setLoading(false);
        }
        return;
      }
    }
    
    try {
        // Use Firebase sendOTP service
        const result = await sendOTP(`+91${phoneNumber}`, recaptchaVerifier!);
        if (result.success && result.confirmationResult) {
            setConfirmationResult(result.confirmationResult);
            console.log('OTP sent!');
        } else {
            setError(result.message);
        }
        setStep('otp');
    } catch (err: any) {
        setError("An unexpected error occurred: " + err.message);
    } finally {
        setLoading(false);
    }
  };
  const handleVerifyOtp = async (e: React.FormEvent) => {
      e.preventDefault();
      if (otp.length !== 6) {
          setError("Please enter a valid 6-digit OTP");
          return;
      }

      setLoading(true);
      setError(null); // Clear previous errors

      if (!confirmationResult) {
        // Fallback to local auth verification
        try {
          const user = await authService.verifyOtpAndLogin(`+91${phoneNumber}`, otp, selectedRole || 'non-university');
          onLogin(user);
          navigate('/dashboard');
        } catch (err: any) {
          setError(err.message || "Invalid OTP. Default test code is '123456'.");
        } finally {
          setLoading(false);
        }
        return;
      }

      if (!recaptchaVerifier) {
        setError("OTP request not initiated or reCAPTCHA not set up.");
        setLoading(false);
        return;
      }

      try {
          // Use Firebase verifyOTP service
          const result = await verifyOTP(otp, confirmationResult, recaptchaVerifier);
          if (result.success && result.data) {
            onLogin(result.data.user as UserType); // Cast to UserType if needed, assuming Firebase User is compatible
            navigate('/');
          } else {
            setError(result.message);
          }
      } catch (err: any) {
          console.error("OTP Error:", err);
          setError(err.message || "Invalid OTP. Please check the code sent to your phone.");
      } finally {
          setLoading(false);
      }
  };

  const goBack = () => {
      setError(null);
      if (step === 'otp') {
        recaptchaVerifier?.clear(); // Clear reCAPTCHA if going back from OTP
        setStep('phone');
      } else if (step === 'phone') setStep('method');
      else if (step === 'method') setStep('role');
  };

  return (
    <div className="min-h-screen flex flex-col justify-center bg-gray-50 px-4 py-12 relative overflow-x-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-64 md:h-96 bg-slate-900 skew-y-3 -translate-y-20 z-0 transform origin-top-left scale-110"></div>
      
      <div className="relative z-10 w-full max-w-5xl mx-auto">
        <div className="text-center mb-8 md:mb-12 mt-12 md:mt-0">
          <h1 className="text-3xl md:text-5xl font-display font-bold text-white mb-2 md:mb-4">Welcome to IDEA Lab</h1>
          <p className="text-slate-300 text-sm md:text-lg">Access Portal for Innovation & Research</p>
        </div>

        {step === 'role' && (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 animate-fade-in max-w-sm md:max-w-none mx-auto">
                {/* University Member Card */}
                <div 
                    onClick={() => handleRoleSelect('university')}
                    className="bg-white rounded-3xl p-6 md:p-8 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border border-gray-100 flex flex-col items-center text-center cursor-pointer group"
                >
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-orange-50 rounded-full flex items-center justify-center mb-4 md:mb-6 group-hover:bg-brand-500 transition-colors">
                        <GraduationCap className="w-8 h-8 md:w-10 md:h-10 text-brand-600 group-hover:text-white transition-colors" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-display font-bold text-slate-900 mb-1 md:mb-2">University Member</h2>
                    <p className="text-slate-500 text-xs md:text-sm mb-4 md:mb-6">Students & Faculty of REVA University</p>
                    <button className="mt-auto px-6 py-2 bg-slate-100 text-slate-600 rounded-full font-bold text-xs md:text-sm group-hover:bg-brand-600 group-hover:text-white transition-all w-full md:w-auto">Proceed</button>
                </div>

                {/* Guest / Non-University Card */}
                <div 
                    onClick={() => handleRoleSelect('non-university')}
                    className="bg-white rounded-3xl p-6 md:p-8 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border border-gray-100 flex flex-col items-center text-center cursor-pointer group relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 bg-yellow-400 text-slate-900 text-[10px] md:text-xs font-bold px-3 py-1 rounded-bl-xl">External</div>
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4 md:mb-6 group-hover:bg-blue-600 transition-colors">
                        <Globe className="w-8 h-8 md:w-10 md:h-10 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-display font-bold text-slate-900 mb-1 md:mb-2">Guest User</h2>
                    <p className="text-slate-500 text-xs md:text-sm mb-4 md:mb-6">Visitors, Alumni & Researchers</p>
                    <button className="mt-auto px-6 py-2 bg-slate-100 text-slate-600 rounded-full font-bold text-xs md:text-sm group-hover:bg-blue-600 group-hover:text-white transition-all w-full md:w-auto">Proceed</button>
                </div>

                {/* Staff Card */}
                <div className="bg-slate-900 rounded-3xl p-6 md:p-8 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border border-slate-700 flex flex-col items-center text-center text-white">
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-white/10 rounded-full flex items-center justify-center mb-4 md:mb-6 border border-white/20">
                    <ShieldCheck className="w-8 h-8 md:w-10 md:h-10 text-brand-500" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-display font-bold text-white mb-1 md:mb-2">Lab Staff</h2>
                    <p className="text-slate-400 text-xs md:text-sm mb-6 md:mb-8">Administrators & Assistants</p>
                    
                    <button 
                    onClick={() => navigate('/staff-login')}
                    className="w-full mt-auto py-3 px-4 bg-brand-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-700 transition-colors shadow-lg shadow-brand-500/20 text-sm"
                    >
                    <span>Staff Login</span>
                    <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        )}

        {/* METHOD SELECTION STEP */}
        {step === 'method' && (
             <div className="max-w-md mx-auto bg-white rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up relative">
                 <button onClick={goBack} className="absolute top-4 left-4 p-2 hover:bg-gray-100 rounded-full transition-colors text-slate-400 hover:text-slate-900">
                     <ChevronLeft className="w-6 h-6" />
                 </button>

                 <div className="text-center mb-8 pt-6">
                     <h2 className="text-xl md:text-2xl font-bold text-slate-900 mb-2">
                         {selectedRole === 'university' ? 'University Access' : 'Guest Access'}
                     </h2>
                     <p className="text-slate-500 text-xs md:text-sm">
                         Choose your preferred login method.
                     </p>
                 </div>

                 <div className="space-y-4">
                     {selectedRole === 'university' ? (
                        <button 
                            onClick={() => handleOAuthLogin('microsoft')}
                            disabled={loading}
                            className="w-full py-4 bg-white border border-gray-200 text-slate-700 rounded-xl font-bold hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm flex items-center justify-center gap-3"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MicrosoftLogo />}
                            <span>Sign in with Microsoft</span>
                        </button>
                     ) : (
                        <button 
                            onClick={() => handleOAuthLogin('google')}
                            disabled={loading}
                            className="w-full py-4 bg-white border border-gray-200 text-slate-700 rounded-xl font-bold hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm flex items-center justify-center gap-3"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleLogo />}
                            <span>Sign in with Google</span>
                        </button>
                     )}

                     <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-gray-200"></div>
                        <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-bold uppercase">Or</span>
                        <div className="flex-grow border-t border-gray-200"></div>
                     </div>

                     <button 
                        onClick={() => setStep('phone')}
                        className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-brand-600 transition-colors shadow-lg flex items-center justify-center gap-3"
                     >
                        <Smartphone className="w-5 h-5" />
                        <span>Use Mobile Number</span>
                     </button>
                 </div>
             </div>
        )}

        {/* PHONE & OTP STEPS */}
        {(step === 'phone' || step === 'otp') && (
            <div className="max-w-md mx-auto bg-white rounded-3xl shadow-2xl p-6 md:p-8 animate-slide-up relative">
                 <button onClick={goBack} className="absolute top-4 left-4 p-2 hover:bg-gray-100 rounded-full transition-colors text-slate-400 hover:text-slate-900">
                     <ChevronLeft className="w-6 h-6" />
                 </button>

                 <div className="text-center mb-8 pt-6">
                     <div className="w-14 h-14 md:w-16 md:h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-brand-600">
                         {step === 'phone' ? <Smartphone className="w-7 h-7 md:w-8 md:h-8" /> : <KeyRound className="w-7 h-7 md:w-8 md:h-8" />}
                     </div>
                     <h2 className="text-xl md:text-2xl font-bold text-slate-900 mb-2">
                         {step === 'phone' ? 'Mobile Verification' : 'Enter OTP'}
                     </h2>
                     <p className="text-slate-500 text-xs md:text-sm">
                         {step === 'phone' ? 'We use mobile numbers for secure tracking and lab access.' : `Enter the 6-digit code (Use 123456)`}
                     </p>
                 </div>

                 {step === 'phone' ? (
                     <form onSubmit={handleSendOtp} className="space-y-6">
                         <div>
                             <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Phone Number</label>
                             <div className="flex bg-gray-50 border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500 transition-all">
                                 <span className="bg-gray-100 px-4 py-3 text-slate-500 font-bold border-r border-gray-200">+91</span>
                                 <input 
                                    type="tel"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    placeholder="98765 43210"
                                    className="flex-grow bg-transparent px-4 py-3 outline-none font-medium text-slate-900"
                                    autoFocus
                                 />
                             </div>
                         </div>
                         {error && <p className="text-red-500 text-xs text-center font-bold bg-red-50 p-2 rounded-lg">{error}</p>}
                         <button 
                            type="submit" 
                            disabled={loading}
                            className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-brand-600 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-70"
                         >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Get OTP'}
                         </button>
                     </form>
                 ) : (
                    <form onSubmit={handleVerifyOtp} className="space-y-6">
                         <div className="flex justify-center gap-2">
                             <input 
                                type="text"
                                maxLength={6}
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="------"
                                className="w-full max-w-[200px] text-center text-3xl tracking-[0.5em] py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 font-bold text-slate-900 placeholder:text-gray-300"
                                autoComplete="one-time-code"
                                autoFocus
                             />
                         </div>
                         <p className="text-xs text-center text-slate-400">
                            Did not receive code? <button type="button" onClick={() => setStep('phone')} className="text-brand-600 font-bold hover:underline">Resend</button>
                         </p>
                         
                         {error && <p className="text-red-500 text-xs text-center font-bold bg-red-50 p-2 rounded-lg">{error}</p>}
                         
                         <button 
                            type="submit" 
                            disabled={loading}
                            className="w-full py-4 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-70"
                         >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify & Login'}
                         </button>
                    </form>
                 )}
            </div>
        )}
        {/* reCAPTCHA Container - Required for Firebase */}
        {(step === 'phone' || step === 'otp') && (
          <div id="recaptcha-container" className="mt-4"></div>
        )}
      </div>
    </div>
  );
};

export const Login2 = Login;
export default Login;
