import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginPage    from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ChatLayout   from "./pages/ChatLayout";
import CalendarPage from "./pages/CalendarPage";
import PrivateRoute from "./components/PrivateRoute";

const theme = createTheme({ palette: { primary: { main: "#1976d2" } } });

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <RouterImpl />
      </AuthProvider>
    </ThemeProvider>
  );
}

/* ------- RouterImpl 분리 ------- */
function RouterImpl() {
  const { token } = useAuth();        // ← 전역 state
  const defaultRoute = token ? "/chat" : "/login";

  return (
    <BrowserRouter>
      {token && (   /* 상단 글로벌 네비바 – 로그인 직후에도 바로 뜸 */
        <AppBar position="static">
          <Toolbar>
            <Typography sx={{ flexGrow: 1 }}>AI Assistant</Typography>
            <Button color="inherit" component={Link} to="/chat">CHAT</Button>
            <Button color="inherit" component={Link} to="/calendar">CALENDAR</Button>
          </Toolbar>
        </AppBar>
      )}

      <Box sx={{ height: token ? "calc(100vh - 64px)" : "100vh" }}>
        <Routes>
          <Route path="/" element={<Navigate to={defaultRoute} replace />} />
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/chat"
            element={
              <PrivateRoute>
                <ChatLayout />
              </PrivateRoute>
            }
          />

          <Route
            path="/calendar"
            element={
              <PrivateRoute>
                <CalendarPage />
              </PrivateRoute>
            }
          />

          <Route path="*" element={<div>Not Found</div>} />
        </Routes>
      </Box>
    </BrowserRouter>
  );
}
