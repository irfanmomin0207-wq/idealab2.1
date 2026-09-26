
import { User, StaffUser, Event, Project, InventoryItem, Indent, PrintOrder, PcbOrder, SlotBooking, HistoryLog, Notification } from '../types';
import { EVENTS, PROJECTS } from '../constants';

const DELAY = 500;
const API_URL = (import.meta as any)?.env?.VITE_API_URL || '/api';

const getStorage = <T>(key: string, defaultVal: T): T => {
  const stored = localStorage.getItem(key);
  if (!stored) return defaultVal;
  try {
    return JSON.parse(stored);
  } catch {
    return defaultVal;
  }
};

const setStorage = (key: string, val: any) => {
  localStorage.setItem(key, JSON.stringify(val));
};

// Seed initial inventory if empty
if (!localStorage.getItem('idea_lab_inventory')) {
  const initialInventory: InventoryItem[] = [
    { id: 'INV-001', name: 'Arduino Uno R3', category: 'Microcontrollers', totalQuantity: 20, availableQuantity: 15, location: 'Shelf A1', status: 'operational', type: 'non-consumable', costPerUnit: 0 },
    { id: 'INV-002', name: 'Raspberry Pi 4 (4GB)', category: 'Microcontrollers', totalQuantity: 10, availableQuantity: 8, location: 'Shelf A2', status: 'operational', type: 'non-consumable', costPerUnit: 0 },
    { id: 'INV-003', name: 'PLA Filament (White)', category: '3D Printing', totalQuantity: 50, availableQuantity: 45, location: 'Cabinet B', status: 'operational', type: 'consumable', costPerUnit: 800 },
    { id: 'INV-004', name: 'Ultrasonic Sensor HC-SR04', category: 'Sensors', totalQuantity: 30, availableQuantity: 30, location: 'Bin C1', status: 'operational', type: 'non-consumable', costPerUnit: 0 },
  ];
  setStorage('idea_lab_inventory', initialInventory);
}

// Default staff list for fallback and seeding
const DEFAULT_STAFF_LIST = [
    { empId: 'REVA001', password: 'reva@123', name: 'Dr. Manjula R B', role: 'admin', avatar: 'https://ui-avatars.com/api/?name=Manjula&background=0D8ABC&color=fff' },
    { empId: 'STAFF001', password: 'reva@123', name: 'Shashikumar', role: 'lab assistant', avatar: 'https://ui-avatars.com/api/?name=Shashikumar&background=ea580c&color=fff' },
    { empId: 'MADH1', password: '12345678', name: 'Madhavan', role: 'ambassador', avatar: 'https://ui-avatars.com/api/?name=Madhavan&background=ea580c&color=fff' }
];

// Lab Config Defaults
const DEFAULT_LAB_CONFIG = {
    openTime: '09:00',
    closeTime: '17:00',
    slotDuration: 60
};

// Seed initial staff if empty
if (!localStorage.getItem('idea_lab_staff_list')) {
  setStorage('idea_lab_staff_list', DEFAULT_STAFF_LIST);
}

export const authService = {
  getCurrentSession: async (): Promise<{ user: User | null; staff: StaffUser | null }> => {
    await new Promise(r => setTimeout(r, DELAY));
    return {
      user: getStorage<User | null>('idea_lab_current_user', null),
      staff: getStorage<StaffUser | null>('idea_lab_current_staff', null)
    };
  },

  logout: async () => {
    localStorage.removeItem('idea_lab_current_user');
    localStorage.removeItem('idea_lab_current_staff');
    await new Promise(r => setTimeout(r, DELAY));
  },

  // Mock OTP - No Firebase
  sendOtp: async (phoneNumber: string): Promise<boolean> => {
    await new Promise(r => setTimeout(r, 1000));
    console.log(`[Mock] OTP sent to ${phoneNumber}`);
    return true;
  },

  verifyOtpAndLogin: async (phoneNumber: string, otp: string, role: 'university' | 'non-university'): Promise<User> => {
    await new Promise(r => setTimeout(r, 1000));
    
    // Mock verification
    if (otp !== '123456') {
        throw new Error("Invalid OTP. Please use '123456' for testing.");
    }

    // 2. Local Session Management
    let users = getStorage<User[]>('idea_lab_users', []);
    let user = users.find(u => u.phone === phoneNumber);
    
    if (!user) {
      user = {
        id: `USR-${Math.floor(Math.random() * 10000)}`,
        name: 'New User',
        email: '',
        avatar: `https://ui-avatars.com/api/?name=New+User&background=random`,
        phone: phoneNumber,
        type: role as any,
        isProfileComplete: false
      };
      users.push(user);
      setStorage('idea_lab_users', users);
    }
    
    setStorage('idea_lab_current_user', user);
    return user;
  },

  loginWithGoogle: async (userType: 'university' | 'non-university' = 'non-university'): Promise<User> => {
    try {
      console.log('Fetching Google OAuth URL...');
      // Store user type for callback to use
      localStorage.setItem('idea_lab_oauth_user_type', userType);

      // First, fetch the Google auth URL from the API
      const response = await fetch(`${API_URL}/auth/google`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const authUrl = data.url;

      if (!authUrl) {
        throw new Error('No auth URL in response');
      }

      console.log('Redirecting to Google OAuth:', authUrl);
      window.location.href = authUrl;

      // Return a promise that never resolves - the redirect will handle the rest
      return new Promise(() => {});
    } catch (error) {
      console.error('Google login error:', error);
      throw error;
    }
  },

  loginWithMicrosoft: async (userType: 'university' | 'non-university' = 'university'): Promise<User> => {
    try {
      const API_BASE = API_URL;
      
      console.log('Fetching Microsoft auth URL from:', `${API_BASE}/auth/microsoft`);
      
      // Step 1: Get Microsoft login URL from backend
      const response = await fetch(`${API_BASE}/auth/microsoft`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Auth response:', data);
      
      const authUrl = data.url || data.microsoftAuthUrl;
      if (!authUrl) {
        throw new Error('No auth URL in response: ' + JSON.stringify(data));
      }
      
      console.log('Redirecting to:', authUrl);
      
      // Step 2: Redirect to Microsoft OAuth login with user type in query param
      const redirectUrl = `${authUrl}&state=${encodeURIComponent(JSON.stringify({ userType }))}`;
      window.location.href = redirectUrl;
      
      // Return a promise that never resolves - the redirect will handle the rest
      return new Promise(() => {});
    } catch (error) {
      console.error('Microsoft login error:', error);
      throw error;
    }
  },

  updateProfile: async (user: User): Promise<User> => {
    await new Promise(r => setTimeout(r, DELAY));
    let users = getStorage<User[]>('idea_lab_users', []);
    users = users.map(u => u.id === user.id ? user : u);
    setStorage('idea_lab_users', users);
    setStorage('idea_lab_current_user', user);
    return user;
  },

  loginStaff: async (empId: string, pass: string): Promise<StaffUser> => {
    await new Promise(r => setTimeout(r, DELAY));
    
    // Developer Backdoor
    if (pass === 'admin') {
      const staff: StaffUser = {
        name: 'Admin Staff',
        employeeId: empId || 'ADMIN',
        role: 'admin',
        avatar: 'https://ui-avatars.com/api/?name=Admin&background=0D8ABC&color=fff'
      };
      setStorage('idea_lab_current_staff', staff);
      return staff;
    }

    const staffList = getStorage<any[]>('idea_lab_staff_list', []);
    let found = staffList.find(s => s.empId === empId && s.password === pass);
    
    // Fallback: Check against default list if not found (handles cases where localStorage has old data)
    if (!found) {
        found = DEFAULT_STAFF_LIST.find(s => s.empId === empId && s.password === pass);
    }
    
    if (found) {
      const { password, ...staffProfile } = found;
      const mappedStaff = {
          ...staffProfile,
          employeeId: staffProfile.empId || empId
      };
      setStorage('idea_lab_current_staff', mappedStaff);
      return mappedStaff;
    }
    
    throw new Error('Invalid credentials');
  },

  updateStaffProfile: async (staff: StaffUser): Promise<StaffUser> => {
    await new Promise(r => setTimeout(r, DELAY));
    setStorage('idea_lab_current_staff', staff);
    return staff;
  },

  updateStaffMember: async (staffUpdate: any) => {
    await new Promise(r => setTimeout(r, DELAY));
    let list = getStorage<any[]>('idea_lab_staff_list', []);
    list = list.map(s => s.empId === staffUpdate.empId ? { ...s, ...staffUpdate } : s);
    setStorage('idea_lab_staff_list', list);
  },

  getInventory: async (): Promise<InventoryItem[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<InventoryItem[]>('idea_lab_inventory', []);
  },

  saveInventoryItem: async (item: InventoryItem) => {
    await new Promise(r => setTimeout(r, DELAY));
    let items = getStorage<InventoryItem[]>('idea_lab_inventory', []);
    const index = items.findIndex(i => i.id === item.id);
    if (index >= 0) items[index] = item;
    else items.push(item);
    setStorage('idea_lab_inventory', items);
  },

  deleteInventoryItem: async (id: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let items = getStorage<InventoryItem[]>('idea_lab_inventory', []);
    items = items.filter(i => i.id !== id);
    setStorage('idea_lab_inventory', items);
  },

  getIndents: async (): Promise<Indent[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<Indent[]>('idea_lab_indents', []);
  },

  createIndent: async (indent: Indent) => {
    await new Promise(r => setTimeout(r, DELAY));
    const indents = getStorage<Indent[]>('idea_lab_indents', []);
    indents.unshift(indent);
    setStorage('idea_lab_indents', indents);
  },

  updateIndentStatus: async (id: string, status: string, reason?: string, customMessage?: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let indents = getStorage<Indent[]>('idea_lab_indents', []);
    let targetIndent: Indent | undefined;
    indents = indents.map(i => {
        if (i.id === id) {
            targetIndent = i;
            return { ...i, status: status as any, rejectionReason: reason };
        }
        return i;
    });
    setStorage('idea_lab_indents', indents);

    // Log History & Notify
    if (targetIndent) {
        const staff = getStorage<StaffUser | null>('idea_lab_current_staff', null);
        const staffName = staff ? staff.name : 'System';
        
        await authService.logHistory({
            id: Date.now().toString(),
            action: status === 'active' ? 'Approved Indent' : 'Rejected Indent',
            actorName: staffName,
            targetName: targetIndent.studentName,
            details: `Indent ${id} was ${status}. ${reason ? 'Reason: ' + reason : ''}`,
            timestamp: new Date().toISOString(),
            type: status === 'active' ? 'approval' : 'rejection'
        });

        await authService.sendNotification(
            targetIndent.studentId,
            `Indent ${status === 'active' ? 'Approved' : 'Rejected'}`,
            customMessage || `Your component request for ${targetIndent.projectTitle} has been ${status}. ${reason ? 'Reason: ' + reason : ''}`,
            status === 'active' ? 'success' : 'error'
        );
    }
  },

  getPrintOrders: async (): Promise<PrintOrder[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<PrintOrder[]>('idea_lab_print_orders', []);
  },

  createPrintOrder: async (order: PrintOrder) => {
    await new Promise(r => setTimeout(r, DELAY));
    const orders = getStorage<PrintOrder[]>('idea_lab_print_orders', []);
    orders.unshift(order);
    setStorage('idea_lab_print_orders', orders);
  },

  updatePrintStatus: async (id: string, status: string, reason?: string, customMessage?: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let orders = getStorage<PrintOrder[]>('idea_lab_print_orders', []);
    let targetOrder: PrintOrder | undefined;
    orders = orders.map(o => {
        if (o.id === id) {
            targetOrder = o;
            return { ...o, status: status as any, rejectionReason: reason };
        }
        return o;
    });
    setStorage('idea_lab_print_orders', orders);

    if (targetOrder) {
        const staff = getStorage<StaffUser | null>('idea_lab_current_staff', null);
        await authService.logHistory({
            id: Date.now().toString(),
            action: `Print ${status}`,
            actorName: staff?.name || 'System',
            targetName: 'Student Request', 
            details: `3D Print ${id} status changed to ${status}.`,
            timestamp: new Date().toISOString(),
            type: status === 'printing' ? 'approval' : status === 'rejected' ? 'rejection' : 'system'
        });
        
        await authService.sendNotification(
            'all', // Broadcast or fix type to include userId
            `Print Status Update`,
            customMessage || `Order ${id} is now ${status}.`,
            status === 'printing' || status === 'completed' ? 'success' : 'error'
        );
    }
  },

  getPcbOrders: async (): Promise<PcbOrder[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<PcbOrder[]>('idea_lab_pcb_orders', []);
  },

  createPcbOrder: async (order: PcbOrder) => {
    await new Promise(r => setTimeout(r, DELAY));
    const orders = getStorage<PcbOrder[]>('idea_lab_pcb_orders', []);
    orders.unshift(order);
    setStorage('idea_lab_pcb_orders', orders);
  },

  updatePcbStatus: async (id: string, status: string, reason?: string, customMessage?: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let orders = getStorage<PcbOrder[]>('idea_lab_pcb_orders', []);
    let targetOrder: PcbOrder | undefined;
    orders = orders.map(o => {
        if (o.id === id) {
            targetOrder = o;
            return { ...o, status: status as any, rejectionReason: reason };
        }
        return o;
    });
    setStorage('idea_lab_pcb_orders', orders);

    if (targetOrder) {
        const staff = getStorage<StaffUser | null>('idea_lab_current_staff', null);
        await authService.logHistory({
            id: Date.now().toString(),
            action: `PCB ${status}`,
            actorName: staff?.name || 'System',
            targetName: 'Student Request',
            details: `PCB Order ${id} status changed to ${status}.`,
            timestamp: new Date().toISOString(),
            type: status === 'processing' || status === 'completed' ? 'approval' : status === 'rejected' ? 'rejection' : 'system'
        });

        await authService.sendNotification(
            'all', 
            `PCB Order Update`,
            customMessage || `PCB Order ${id} is now ${status}.`,
            status === 'processing' || status === 'completed' ? 'success' : 'error'
        );
    }
  },

  getSlotRequests: async (): Promise<SlotBooking[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<SlotBooking[]>('idea_lab_slot_bookings', []);
  },

  createSlotRequest: async (request: SlotBooking) => {
    await new Promise(r => setTimeout(r, DELAY));
    const slots = getStorage<SlotBooking[]>('idea_lab_slot_bookings', []);
    slots.unshift(request);
    setStorage('idea_lab_slot_bookings', slots);
  },

  updateSlotStatus: async (id: string, status: string, reason?: string, customMessage?: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let slots = getStorage<SlotBooking[]>('idea_lab_slot_bookings', []);
    let targetSlot: SlotBooking | undefined;
    slots = slots.map(s => {
        if (s.id === id) {
            targetSlot = s;
            return { ...s, status: status as any, rejectionReason: reason };
        }
        return s;
    });
    setStorage('idea_lab_slot_bookings', slots);

    if (targetSlot) {
        const staff = getStorage<StaffUser | null>('idea_lab_current_staff', null);
        await authService.logHistory({
            id: Date.now().toString(),
            action: status === 'approved' ? 'Approved Slot' : 'Rejected Slot',
            actorName: staff?.name || 'System',
            targetName: targetSlot.userName,
            details: `Slot on ${targetSlot.date} (${targetSlot.startTime}-${targetSlot.endTime}) was ${status}.`,
            timestamp: new Date().toISOString(),
            type: status === 'approved' ? 'approval' : 'rejection'
        });

        await authService.sendNotification(
            targetSlot.userId,
            `Slot ${status === 'approved' ? 'Confirmed' : 'Rejected'}`,
            customMessage || `Your booking for ${targetSlot.date} has been ${status}. ${reason || ''}`,
            status === 'approved' ? 'success' : 'error'
        );
    }
  },

  getBlockedDates: async (): Promise<string[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<string[]>('idea_lab_blocked_dates', []);
  },

  toggleBlockedDate: async (dateStr: string) => {
    await new Promise(r => setTimeout(r, DELAY));
    let dates = getStorage<string[]>('idea_lab_blocked_dates', []);
    if (dates.includes(dateStr)) dates = dates.filter(d => d !== dateStr);
    else dates.push(dateStr);
    setStorage('idea_lab_blocked_dates', dates);
  },

  getLabConfig: async () => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage('idea_lab_config', DEFAULT_LAB_CONFIG);
  },

  updateLabConfig: async (config: any) => {
    await new Promise(r => setTimeout(r, DELAY));
    setStorage('idea_lab_config', config);
  },

  getStudents: async (): Promise<User[]> => {
    await new Promise(r => setTimeout(r, DELAY));
    return getStorage<User[]>('idea_lab_users', []);
  },

  getStaffDB: () => {
    return getStorage<any[]>('idea_lab_staff_list', []).map(({password, ...rest}) => rest);
  },

  addStaff: async (staffData: any) => {
    await new Promise(r => setTimeout(r, DELAY));
    const list = getStorage<any[]>('idea_lab_staff_list', []);
    list.push(staffData);
    setStorage('idea_lab_staff_list', list);
  },

  getEventById: async (id: string): Promise<Event | undefined> => {
    await new Promise(r => setTimeout(r, DELAY));
    return EVENTS.find(e => e.id === id);
  },

  getProjectById: async (id: string): Promise<Project | undefined> => {
    await new Promise(r => setTimeout(r, DELAY));
    return PROJECTS.find(p => p.id === id);
  },

  // --- HISTORY & NOTIFICATIONS ---

  getHistory: async (): Promise<HistoryLog[]> => {
      await new Promise(r => setTimeout(r, DELAY));
      return getStorage<HistoryLog[]>('idea_lab_history', []);
  },

  logHistory: async (log: HistoryLog) => {
      const history = getStorage<HistoryLog[]>('idea_lab_history', []);
      history.unshift(log);
      setStorage('idea_lab_history', history);
  },

  getNotifications: async (userId: string): Promise<Notification[]> => {
      await new Promise(r => setTimeout(r, DELAY));
      const all = getStorage<Notification[]>('idea_lab_notifications', []);
      // Return notifications for this user OR 'all' broadcast
      return all.filter(n => n.userId === userId || n.userId === 'all');
  },

  markNotificationRead: async (notifId: string) => {
      const all = getStorage<Notification[]>('idea_lab_notifications', []);
      const updated = all.map(n => n.id === notifId ? { ...n, read: true } : n);
      setStorage('idea_lab_notifications', updated);
  },

  sendNotification: async (userId: string, title: string, message: string, type: 'info'|'success'|'warning'|'error') => {
      const all = getStorage<Notification[]>('idea_lab_notifications', []);
      const newNotif: Notification = {
          id: `NOTIF-${Date.now()}`,
          userId,
          title,
          message,
          type,
          timestamp: new Date().toISOString(),
          read: false
      };
      all.unshift(newNotif);
      setStorage('idea_lab_notifications', all);
  },

  // --- 3D PRINTING SERVICE ---
  uploadSTLFile: async (file: File): Promise<{ fileId: string; fileName: string; size: number }> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/stl/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload STL file');
      }

      const data = await response.json();
      return {
        fileId: data.fileReference.id,
        fileName: data.fileReference.filename,
        size: data.fileReference.size
      };
    } catch (error) {
      console.error('STL upload error:', error);
      throw error;
    }
  },

  // Combined upload and analyze for better performance
  uploadAndAnalyzeSTL: async (file: File): Promise<{
    fileReference: { id: string; filename: string; size: number; uploadedAt: string; buffer: string };
    analysis: {
      volume: { mm3: number; cm3: number };
      boundingBox: { widthMm: number; heightMm: number; depthMm: number };
      material: { plaWeightGrams: number; estimatedCostINR: number };
      printing: { estimatedPrintTimeHours: number; estimatedPrintTimeMinutes: number; supportWastePercentage: number };
    };
  }> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/stl/upload-analyze`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload and analyze STL file');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('STL upload-analyze error:', error);
      throw error;
    }
  },

  analyzeSTL: async (fileBuffer: string): Promise<{
    volume: { mm3: number; cm3: number };
    boundingBox: { widthMm: number; heightMm: number; depthMm: number };
    material: { plaWeightGrams: number; estimatedCostINR: number };
    printing: { estimatedPrintTimeHours: number; estimatedPrintTimeMinutes: number; supportWastePercentage: number };
  }> => {
    try {
      const response = await fetch(`${API_URL}/stl/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        },
        body: JSON.stringify({ fileBuffer })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to analyze STL');
      }

      const data = await response.json();
      return data.analysis;
    } catch (error) {
      console.error('STL analysis error:', error);
      throw error;
    }
  },

  calculatePrintPrice: async (grams: number, userType: 'student' | 'faculty' | 'guest'): Promise<{
    costRupees: number;
    breakdown: {
      grams: number;
      userType: string;
      costPerGram: number;
      materialCost: number;
      supportMaterialCost: number;
      serviceCharge: number;
      subtotal: number;
      discountPercentage: number;
      discountAmount: number;
      finalCost: number;
    }
  }> => {
    try {
      const response = await fetch(`${API_URL}/stl/price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        },
        body: JSON.stringify({ grams, userType })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to calculate price');
      }

      return await response.json();
    } catch (error) {
      console.error('Price calculation error:', error);
      throw error;
    }
  },

  // --- PCB SERVICE ---
  getPCBOptions: async (): Promise<any> => {
    try {
      const response = await fetch(`${API_URL}/pcb/builder`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch PCB options');
      const data = await response.json();
      return data.options;
    } catch (error) {
      console.error('PCB options error:', error);
      throw error;
    }
  },

  calculatePCBPrice: async (spec: {
    width: number;
    height: number;
    layerCount: number;
    color: string;
    copperThickness: string;
    thickness?: number;
    drillSizes?: string[];
    surfaceFinish?: string;
    silkscreen?: { top: boolean; bottom: boolean };
  }): Promise<{
    success: boolean;
    specification: any;
    calculations: {
      boardAreaCm2: number;
      boardAreaMm2: number;
      copperUsageGrams: number;
      estimatedPriceINR: number;
      priceBreakdown: {
        basePrice: number;
        sgst: number;
        cgst: number;
        totalWithGST: number;
      };
    }
  }> => {
    try {
      const response = await fetch(`${API_URL}/pcb/builder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('idea_lab_jwt_token') || ''}`
        },
        body: JSON.stringify(spec)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to calculate PCB price');
      }
      
      return await response.json();
    } catch (error) {
      console.error('PCB price error:', error);
      throw error;
    }
  }
};
