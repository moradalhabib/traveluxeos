import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLocked: boolean;
  unlock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("traveluxe_session");
    return stored ? JSON.parse(stored) : null;
  });
  const [isLocked, setIsLocked] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!user) return;

    let timeout: NodeJS.Timeout;
    
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setIsLocked(true);
      }, INACTIVITY_TIMEOUT);
    };

    window.addEventListener("mousemove", resetTimeout);
    window.addEventListener("keydown", resetTimeout);
    window.addEventListener("click", resetTimeout);
    window.addEventListener("scroll", resetTimeout);

    resetTimeout();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimeout);
      window.removeEventListener("keydown", resetTimeout);
      window.removeEventListener("click", resetTimeout);
      window.removeEventListener("scroll", resetTimeout);
    };
  }, [user]);

  const login = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem("traveluxe_session", JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    setIsLocked(false);
    localStorage.removeItem("traveluxe_session");
    setLocation("/login");
  };

  const unlock = () => {
    setIsLocked(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLocked, unlock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
