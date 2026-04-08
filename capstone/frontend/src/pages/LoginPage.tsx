// src/pages/LoginPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { API_BASE } from "../lib/api";

// Material UI imports
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack
} from "@mui/material";

function LoginPage() {
  const navigate = useNavigate();
  const { setToken } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("password", password);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Login failed: ${res.status}`);
      }

      const data = await res.json();
      setMsg("Login success");
      setToken(data.access_token);   // ← localStorage + 전역 state 동시 반영
      navigate("/chat");
    } catch (error: any) {
      setMsg(error.message);
    }
  };

  const goRegister = () => {
    navigate("/register");
  };

  return (
    <Box sx={{ margin: 4 }}>
      <Typography variant="h4" gutterBottom>
        Login
      </Typography>

      <Box component="form" onSubmit={handleLogin} sx={{ maxWidth: 300 }}>
        <TextField
          label="Username"
          variant="outlined"
          fullWidth
          margin="normal"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          variant="outlined"
          fullWidth
          margin="normal"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" type="submit">
            Login
          </Button>
          <Button variant="outlined" onClick={goRegister}>
            Go to Register
          </Button>
        </Stack>
      </Box>

      {msg && (
        <Typography color="error" sx={{ mt: 2 }}>
          {msg}
        </Typography>
      )}
    </Box>
  );
}

export default LoginPage;
