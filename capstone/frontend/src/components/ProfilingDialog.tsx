import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stepper, Step, StepLabel, Button, Box, Chip,
  TextField, Typography, CircularProgress
} from "@mui/material";
import { fetchWithAuth } from "../utils/api";

interface Props {
  open: boolean;
  onClose: () => void;       // 단순 닫기(‘나중에 할게요’)
  onSaved: () => void;       // 새 프로필 저장 완료
}

const GENRES = ["액션","코미디","로맨스","스릴러","SF","애니메이션"];
const LEARNINGS = ["백엔드","프론트엔드","AI","마케팅","디자인"];
const CONTENT_TYPES = ["블로그","유튜브","팟캐스트"];

export default function ProfilingDialog({ open, onClose, onSaved }: Props) {
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const [genres, setGenres]         = useState<string[]>([]);
  const [learnings, setLearnings]   = useState<string[]>([]);
  const [ctype, setCtype]           = useState<string>("");

  const toggle = (arr:string[], setter:(v:string[])=>void, val:string) => {
    setter(arr.includes(val) ? arr.filter(v=>v!==val) : [...arr,val]);
  };

  const steps = ["선호 장르", "학습 목표", "콘텐츠 형식"];

  const saveProfile = async () => {
    setLoading(true);
    try {
      await fetchWithAuth("/profile", {
        method: "POST",
        body: JSON.stringify({
          locale : "ko",
          consent: true,
          genres : genres.map(g=>({ genre:g.toLowerCase(), score:5 })),
          tags   : [
            ...learnings.map(t=>({ tag_type:"learning", tag:t.toLowerCase() })),
            ...(ctype ? [{ tag_type:"content_type", tag:ctype.toLowerCase() }] : [])
          ]
        })
      });
    } catch(e) {
      /* 409 등 이미 존재하는 경우 → PATCH 로 대체하거나 무시 */
    }
    setLoading(false);
    onSaved();
  };

  /* ───────── 화면별 UI ───────── */
  const renderStep = () => {
    if (active===0) return (
      <Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>
        {GENRES.map(g=>(
          <Chip key={g} label={g} clickable
            color={genres.includes(g)? "primary" : "default"}
            onClick={()=>toggle(genres,setGenres,g)}
          />
        ))}
      </Box>
    );
    if (active===1) return (
      <Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>
        {LEARNINGS.map(t=>(
          <Chip key={t} label={t} clickable
            color={learnings.includes(t)? "primary":"default"}
            onClick={()=>toggle(learnings,setLearnings,t)}
          />
        ))}
      </Box>
    );
    return (
      <Box sx={{display:"flex",flexDirection:"column",gap:2}}>
        {CONTENT_TYPES.map(t=>(
          <Chip key={t} label={t} clickable
            color={ctype===t? "primary":"default"}
            onClick={()=>setCtype(t)}
          />
        ))}
        <TextField label="기타 (선택)" variant="standard"
          value={ctype} onChange={e=>setCtype(e.target.value)} />
      </Box>
    );
  };

  return (
    <Dialog open={open} fullWidth maxWidth="sm">
      <DialogTitle>당신을 더 잘 이해하기 위해 몇 가지를 알려주세요</DialogTitle>
      <DialogContent dividers sx={{py:3}}>
        <Stepper activeStep={active} sx={{mb:3}}>
          {steps.map(s=><Step key={s}><StepLabel>{s}</StepLabel></Step>)}
        </Stepper>
        {renderStep()}
      </DialogContent>
      <DialogActions sx={{pr:3, pb:2}}>
        <Button onClick={onClose}>나중에 할게요</Button>
        {active>0 && <Button onClick={()=>setActive(p=>p-1)}>이전</Button>}
        {active<steps.length-1
          ? <Button disabled={active===0 && genres.length===0}
                    onClick={()=>setActive(p=>p+1)}>다음</Button>
          : (
            <Button variant="contained"
              disabled={loading || genres.length===0}
              onClick={saveProfile}
              startIcon={loading && <CircularProgress size={18}/>}
            >
              완료
            </Button>
          )
        }
      </DialogActions>
    </Dialog>
  );
}
