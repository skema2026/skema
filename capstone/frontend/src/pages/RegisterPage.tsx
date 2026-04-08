import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack
} from "@mui/material";
import { API_BASE } from "../lib/api";

function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        throw new Error(`Register failed: ${res.status}`);
      }
      const data = await res.json();
      setMsg("Register success: " + JSON.stringify(data));
      navigate("/login");
    } catch (error: any) {
      setMsg(error.message);
    }
  };

  const handleCancel = () => {
    navigate("/login");
  };

  return (
    <Box sx={{ margin: 4 }}>
      <Typography variant="h4" gutterBottom>
        Register
      </Typography>

      <Box component="form" onSubmit={handleRegister} sx={{ maxWidth: 300 }}>
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
            Register
          </Button>
          <Button variant="outlined" onClick={handleCancel}>
            Cancel
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

export default RegisterPage;
