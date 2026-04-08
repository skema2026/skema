// src/pages/ChatLayout.tsx
import {
  useEffect, useState, useRef, useCallback, ChangeEvent, useLayoutEffect
} from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  Box, Drawer, Toolbar, List, ListItemButton, ListItemText, Divider,
  AppBar, Typography, Button, TextField, Switch, FormControlLabel,
  ListSubheader, Dialog, DialogTitle, DialogContent, DialogActions,
  LinearProgress, IconButton, Paper, useTheme,
} from "@mui/material";
import { ThumbUp, ThumbDown, Mic } from "@mui/icons-material";
import { Edit, Delete } from "@mui/icons-material";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import { VariableSizeList, ListChildComponentProps } from "react-window";
import useResizeObserver from "../hooks/useResizeObserver";
import AutoSizer from "react-virtualized-auto-sizer";
import type { Size } from "react-virtualized-auto-sizer";
import { fetchWithAuth } from "../utils/api";
import ProfilingDialog from "../components/ProfilingDialog";
import { Dialog as MuiDialog, /* … */ } from "@mui/material";

/* ---------- types ---------- */
interface FeedbackInfo {
  feedback_id?: number;
  feedback_score?: number;
  feedback_label?: string;
  details?: any;
}
interface RecommendCard {
  card_id: string;
  type: string;
  title: string;
  subtitle?: string;
  link?: string;
  reason?: string;
  score?: number;
  feedback?: FeedbackInfo | null;
}
interface Message {
  message_id: number;
  role: string;
  content: string;
  created_at: string;
  cards?: RecommendCard[];
  images?: ImageThumb[];
  feedback?: FeedbackInfo | null;
}
interface AgendaEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
}
interface ImageThumb {
  image_id: number;
  thumb: string;          // ← 서버 키 그대로
}

/* =================================================================== */
export default function ChatLayout() {
  const navigate = useNavigate();
  const theme = useTheme();

  /* ---------- state ---------- */
  const [userName, setUserName]           = useState("");
  const [profileExists, setProfileExists] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<number|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMode, setInputMode] = useState<"chat" | "summary">("chat");

  const [question,    setQuestion]    = useState("");
  const [searchMode,  setSearchMode]  = useState(false);
  const [uploadFile,  setUploadFile]  = useState<File|null>(null);
  const [isLoading,   setIsLoading]   = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordLeft,  setRecordLeft]  = useState(5);   // ★ NEW – 남은 초
  const recordTimer = useRef<NodeJS.Timeout|null>(null); // ★ NEW

  const [agenda,      setAgenda]      = useState<AgendaEvent[]>([]);
  const [gcConnected, setGcConnected] = useState(false);

  /* ----- quick-event dialog ----- */
  const [openQuick,   setOpenQuick]   = useState(false);
  const [quickTitle,  setQuickTitle]  = useState("");
  const [quickDate,   setQuickDate]   = useState(dayjs().format("YYYY-MM-DD"));

  const [openProfileDlg, setOpenProfileDlg] = useState(false);
  const [editCid,   setEditCid]   = useState<number|null>(null);      // ★ NEW
  const [editTitle, setEditTitle] = useState("");                     // ★ NEW
  const [fullImgUrl, setFullImgUrl] = useState<string|null>(null);

  /* ---------- virtualization refs ---------- */
  const listRef = useRef<VariableSizeList>(null);
  const sizeMap = useRef<{ [k:number]:number }>({});
  const getSize = (idx:number)=> sizeMap.current[idx] ?? 120;     // fallback height
  const setSize = (idx:number,h:number)=>{
    if (sizeMap.current[idx] !== h) {
      sizeMap.current = { ...sizeMap.current, [idx]: h };
      listRef.current?.resetAfterIndex(idx);
    }
  };

  /* =================================================================== */
  /*   1. 첫 로딩   */
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { navigate("/login"); return; }

    /* 프로필 */
    fetchWithAuth("/profile")
      .then(()=> setProfileExists(true))
      .catch(err=>{
        if (err.status===404) { setProfileExists(false); setOpenProfileDlg(true); }
      });

    /* 사용자 · 대화 목록 · 일정 3일 */
    fetchWithAuth("/auth/me").then(d=> setUserName(d.username));
    fetchWithAuth("/chat/conversations").then(setConversations);

    const end = new Date(Date.now()+3*86400e3).toISOString();
    fetchWithAuth(`/events?end=${end}`).then(setAgenda);

    /* GCal 연결 여부 */
    fetchWithAuth("/gcal/status").then(d=> setGcConnected(d.connected));
  }, []);

  /*   2. 대화 선택 → 메시지 로딩   */
  useEffect(() => {
    if (!selectedConversation) { setMessages([]); return; }
    loadConversation(selectedConversation);
  }, [selectedConversation]);

  useEffect(() => {
    if (!messages.length || !listRef.current) return;
    // 마지막 행으로 스크롤 – 'end' 는 살짝 여유를 둬 깔끔
    listRef.current.scrollToItem(messages.length - 1, "end");
  }, [messages.length]);   // ← 메시지 개수 변할 때마다 실행

  /* ---------- helpers ---------- */
  const loadConversation = async (cid:number)=>{
    const d = await fetchWithAuth(`/chat/conversations/${cid}`);
    const sorted = [...d.messages].sort(
      (a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    setMessages(sorted);
    sizeMap.current = {};
    listRef.current?.resetAfterIndex(0);
  };
  const loadConversationList = async ()=>{
    setConversations(await fetchWithAuth("/chat/conversations"));
  };
  const reloadAgenda = async ()=>{
    const end = new Date(Date.now()+3*86400e3).toISOString();
    setAgenda(await fetchWithAuth(`/events?end=${end}`));
  };
  const refreshGcalStatus = async ()=>{
    const { connected } = await fetchWithAuth("/gcal/status");
    setGcConnected(connected);
  };

  /* ---------- Google Calendar 연결/해제 ---------- */
  const toggleGoogle = async ()=>{
    if (!gcConnected) {
      const { auth_url } = await fetchWithAuth("/gcal/authorize");
      const popup = window.open(auth_url,"_blank","width=500,height=650");
      const handler = (e:MessageEvent)=>{
        if(e.data==="gcal_success"){ popup?.close(); window.removeEventListener("message",handler); refreshGcalStatus(); reloadAgenda(); }
      };
      window.addEventListener("message",handler);
    } else {
      setGcConnected(false); setAgenda([]);
      await fetchWithAuth("/gcal/disconnect",{method:"DELETE"}); refreshGcalStatus();
    }
  };

  /* ---------- 새로운 대화 ---------- */
  const newConversation = ()=>{
    setSelectedConversation(null);
    setMessages([]);
    sizeMap.current = {};
  };

  const renameConversation = async (cid: number, title: string) => {
    await fetchWithAuth(`/chat/conversations/${cid}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
      raw: true,                 // 🔑 204(또는 body 없음) 대비
    });
    await loadConversationList();
    if (selectedConversation === cid) loadConversation(cid); // 제목 즉시 반영
  };
  
  const deleteConversation = async (cid: number) => {
    if (!window.confirm("선택한 대화를 정말 삭제할까요?")) return;
  
    await fetchWithAuth(`/chat/conversations/${cid}`, {
      method: "DELETE",
      raw: true,                 // 🔑 204 대비
    });
  
    // 목록 새로고침
    await loadConversationList();
  
    // 방금 보고 있던 대화를 지웠다면 → 오른쪽 패널도 초기화
    if (selectedConversation === cid) {
      setSelectedConversation(null);
      setMessages([]);
      sizeMap.current = {};                 // 🔑 react-window 높이 캐시 리셋
      listRef.current?.resetAfterIndex(0);
    }
  };

  /* =================================================================== */
  /*   3. send() – 기존 REST 흐름 유지   */
  const send = async ()=>{
    if (!question.trim() || isLoading) return;
    setIsLoading(true);

    const endpoint = searchMode ? "/search" : "/chat";
    const payload  = {
      conversation_id: selectedConversation,
      question,
      query: question,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    try{
      const data = await fetchWithAuth(endpoint,{ method:"POST", body:JSON.stringify(payload) });

      /* 대화 · 메시지 · 일정 다시 읽기 */
      if (data.conversation_id) {
        setSelectedConversation(data.conversation_id);
        await loadConversation(data.conversation_id);
        await loadConversationList();
        await reloadAgenda();
      }
    } finally {
      setIsLoading(false);
      setQuestion("");
    }
  };

  /* ---------- 음성 녹음 + 전송 ---------- */
  const recordAndSend = async () => {
    if (isRecording || isLoading) return;
  
    /* ① 녹음 시작 --------------------------------------------------- */
    setIsRecording(true);
    setRecordLeft(5);
    recordTimer.current && clearInterval(recordTimer.current);
    recordTimer.current = setInterval(() => {
      setRecordLeft((sec) => (sec > 1 ? sec - 1 : sec));
    }, 1_000);
  
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media  = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const chunks: BlobPart[] = [];
    media.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    media.start();
  
    /* ② 5초 후 자동 종료 ------------------------------------------- */
    await new Promise<void>((res) => setTimeout(res, 5_000));
    media.stop();
    await new Promise<void>((res) => (media.onstop = () => res()));
    stream.getTracks().forEach((t) => t.stop());
  
    /* ③ 팝업 닫기 & 타이머 해제 ------------------------------------- */
    recordTimer.current && clearInterval(recordTimer.current);
    setIsRecording(false);
  
    /* ④ 백엔드 전송(이전 코드 그대로) ------------------------------- */
    const blob = new Blob(chunks, { type: "audio/webm" });
    const fd   = new FormData();
    if (selectedConversation) fd.append("conversation_id", String(selectedConversation));
    fd.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    fd.append("audio", blob, "speech.webm");
  
    setIsLoading(true);
    try {
      const data = await fetchWithAuth("/speech/chat", { method: "POST", body: fd });
      if (data.conversation_id) {
        setSelectedConversation(data.conversation_id);
        await loadConversation(data.conversation_id);
        await loadConversationList();
        await reloadAgenda();
      }
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------- 파일 요약 ---------- */
  const summarize = async ()=>{
    if(!uploadFile) return;
    setIsLoading(true);

    const fd = new FormData();
    fd.append("file",uploadFile);
    if(selectedConversation) fd.append("conversation_id",String(selectedConversation));

    const data = await fetchWithAuth("/summarize",{method:"POST",body:fd});
    if(data.conversation_id) setSelectedConversation(data.conversation_id);

    let summaryText: string;

    if (typeof data.summary === "string" && data.summary.startsWith('"')) {
      // 따옴표로 둘러싸인 형태면 JSON.parse 시도
      try {
        summaryText = JSON.parse(data.summary)
                          .replace(/\\n/g, "\n")      // \n → 줄바꿈
                          .replace(/\\"/g, "\"");      // \" → "
      } catch {
        summaryText = data.summary;                   // 실패하면 원본 유지
      }
    } else {
      summaryText = String(data.summary);
    }

    const now = Date.now();
    setMessages(p=>[
      ...p,
      {message_id:now,role:"user",content:`[파일요약] ${uploadFile.name}`,created_at:new Date().toISOString()},
      {message_id:now+1,role:"assistant",content:summaryText,created_at:new Date().toISOString()},
    ]);
    setUploadFile(null);
    setIsLoading(false);
  };

  /* ---------- 피드백 ---------- */
  const sendCardFeedback = async (card_id:string,label:string)=>{
    await fetchWithAuth("/feedback",{method:"POST",body:JSON.stringify({
      category:"recommend",reference_id:`card_id=${card_id}`,feedback_label:label
    })});
    if(selectedConversation) loadConversation(selectedConversation);
  };
  const sendMessageFeedback = async (mid:number,label:string)=>{
    await fetchWithAuth("/feedback",{method:"POST",body:JSON.stringify({
      category:"chat",reference_id:`message_${mid}`,feedback_label:label
    })});
    if(selectedConversation) loadConversation(selectedConversation);
  };
  const iconColor = (current:string|undefined,target:string)=>(
    current===target ? (target==="like"?"success":"error") : "default"
  );

  /* =================================================================== */
  /*   4. react-window Row renderer   */
  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const m = messages[index];
      const isAssistant = m.role === "assistant";
  
      const rowStyle: React.CSSProperties = { ...style, width: "100%" };
      const measuredRef = useResizeObserver(rect => {
        const h = rect.height + 8;
        if (sizeMap.current[index] !== h) {
          sizeMap.current = { ...sizeMap.current, [index]: h };
          listRef.current?.resetAfterIndex(index);

          if (index === messages.length - 1) {
            listRef.current?.scrollToItem(index, "end");
          }
        }
      });
  
      return (
        <div style={rowStyle}>
          <Box ref={measuredRef} sx={{ px:1, py:0.5 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {m.role}:
            </Typography>

          {m.cards?.length ? (
            <Box sx={{ mt:1, pl:2, borderLeft:`4px solid ${theme.palette.divider}` }}>
              {m.cards.map(card=>(
                <Box key={card.card_id} sx={{ mb:1 }}>
                  <Typography variant="subtitle1" fontWeight="bold">{card.title}</Typography>
                  {card.subtitle && <Typography variant="body2" color="text.secondary">{card.subtitle}</Typography>}
                  {card.link && (
                    <Button size="small" variant="outlined" onClick={()=>window.open(card.link,"_blank")}>자세히</Button>
                  )}
                  {card.reason && (
                    <Typography variant="caption" sx={{ display:"block", mt:0.5 }}>사유: {card.reason}</Typography>
                  )}
                  <Box sx={{ display:"flex", gap:0.5, mt:0.5 }}>
                    <IconButton
                      size="small"
                      color={iconColor(card.feedback?.feedback_label,"like")}
                      onClick={()=>sendCardFeedback(card.card_id,"like")}
                    ><ThumbUp fontSize="inherit" /></IconButton>
                    <IconButton
                      size="small"
                      color={iconColor(card.feedback?.feedback_label,"dislike")}
                      onClick={()=>sendCardFeedback(card.card_id,"dislike")}
                    ><ThumbDown fontSize="inherit" /></IconButton>
                  </Box>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography
              whiteSpace="pre-line"
              sx={{ wordBreak:"break-word" }}
            >
              {m.content}
            </Typography>
          )}

          {m.images?.length ? (
            <Box sx={{ mt: 1, display:"flex", gap:1, flexWrap:"wrap" }}>
              {m.images.map(img => (
                <Box key={img.image_id}>
                  <img
                    src={`data:image/webp;base64,${img.thumb}`}
                    width={128}
                    height={128}
                    style={{
                      objectFit: "cover",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                    onLoad={(e) => {
                      /* react-window 높이 재계산 */
                      const h = Math.max(e.currentTarget.height, 128) + 40;
                      setSize(index, h);
                    }}
                    onClick={async ()=>{
                      // 1) 인증 토큰 포함 GET
                      const res = await fetchWithAuth(`/chat/images/${img.image_id}`, {
                        raw: true                           // fetchWithAuth 래퍼에 body 없는 raw 응답 옵션
                      });
                    
                      // res 는 Blob (image/webp) — URL.createObjectURL 로 변환
                      const blob = await res.blob();
                      setFullImgUrl(URL.createObjectURL(blob));
                    }}
                  />
                </Box>
              ))}
            </Box>
          ) : null}

          {isAssistant && (
            <Box sx={{ display:"flex", gap:0.5, mt:1 }}>
              <IconButton size="small" color={iconColor(m.feedback?.feedback_label,"like")}   onClick={()=>sendMessageFeedback(m.message_id,"like")}  ><ThumbUp   fontSize="inherit"/></IconButton>
              <IconButton size="small" color={iconColor(m.feedback?.feedback_label,"dislike")}onClick={()=>sendMessageFeedback(m.message_id,"dislike")}><ThumbDown fontSize="inherit"/></IconButton>
            </Box>
          )}
        </Box>
      </div>
    );
  },[messages]);

  /* =================================================================== */
  /*   5. render   */
  return (
    <Box sx={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* ---------------- Drawer ---------------- */}
      <Drawer variant="permanent" sx={{ width:240,
        [`& .MuiDrawer-paper`]:{ width:240, top:64, boxSizing:"border-box" } }}>
        <Toolbar />
        <List>
          <ListItemButton sx={{ bgcolor:"action.hover" }} onClick={newConversation}>
            <ListItemText primary="새로운 대화 시작"/>
          </ListItemButton>
          <Divider />
          {conversations.map(c=>(
            <ListItemButton key={c.conversation_id}
              selected={c.conversation_id===selectedConversation}
              onClick={()=>setSelectedConversation(c.conversation_id)}
              sx={{ pr:8 /* 아이콘 공간 확보 */ }}                          // ★ NEW
            >
              <ListItemText
                primary={c.title||`Conv ${c.conversation_id}`}
                primaryTypographyProps={{ noWrap:true }}
              />
              {/* 오른쪽 편집·삭제 아이콘 (hover 시만 불투명) */}
              <Box
                sx={{
                  position:"absolute", right:8, display:"flex", gap:0.5,
                  opacity:0.0, transition:"opacity .2s",
                  "&:hover":{ opacity:1.0 }
                }}
              >
                <IconButton
                  size="small"
                  onClick={(e)=>{ e.stopPropagation(); setEditCid(c.conversation_id); setEditTitle(c.title||""); }}
                ><Edit fontSize="inherit"/></IconButton>
                <IconButton
                  size="small"
                  onClick={(e)=>{ e.stopPropagation(); deleteConversation(c.conversation_id); }}
                ><Delete fontSize="inherit"/></IconButton>
              </Box>
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <List subheader={<ListSubheader>다가오는 일정</ListSubheader>}>
          {agenda.map(ev=>(
            <ListItemButton key={ev.id} onClick={()=>navigate(`/calendar?e=${ev.id}`)}>
              <ListItemText
                primary={ev.summary}
                secondary={dayjs(ev.start.dateTime||ev.start.date).format("DD HH:mm")}
              />
            </ListItemButton>
          ))}
          {!agenda.length && <ListItemText sx={{ p:2 }} secondary="예정된 일정 없음"/>}

          {/* ─── 새로 추가된 “빠른 일정” 버튼 ─── */}
          <ListItemButton
            sx={{ mt:1, bgcolor:"action.hover" }}
            onClick={()=>setOpenQuick(true)}
          >
            <ListItemText primary="＋ 빠른 일정" />
          </ListItemButton>
        </List>
      </Drawer>

      {/* ---------------- Main ---------------- */}
      <Box sx={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, 
        minHeight: 0, p:2, gap: 1
       }}>
        {/* AppBar */}
        <AppBar position="relative" color="default" sx={{ zIndex:1200 }}>
          <Toolbar>
            <Typography sx={{ flexGrow:1 }}>대화</Typography>
            <Button variant="outlined" onClick={toggleGoogle} sx={{ mr:2 }}>
              {gcConnected ? "Google 연결 해제" : "Google 연결"}
            </Button>
            <Typography sx={{ mr:2 }}>{userName}</Typography>
            {profileExists && <Button variant="outlined" sx={{ mr:2 }} onClick={()=>{ setProfileExists(false); setOpenProfileDlg(true); }}>프로필 편집</Button>}
            <Button onClick={()=>{ localStorage.removeItem("token"); navigate("/login"); }}>Logout</Button>
          </Toolbar>
        </AppBar>

        {isLoading && <LinearProgress />}

        {/* 메시지 영역 */}
        <Paper
          sx={{
            flex: "1 1 auto",   // column 내부에서 ‘가변(남는) 높이’ 영역
            minHeight: 0,       // 중요: react-window 가 정확히 height 계산
            overflow: "hidden",
          }}
        >
          {messages.length===0 ? (
            <Box sx={{ p:2 }}><Typography color="text.secondary">대화가 없습니다.</Typography></Box>
          ) : (
            <AutoSizer>
              {({ height, width }: Size) => (
                <VariableSizeList
                  ref={listRef}
                  height={height}
                  width={width}
                  itemCount={messages.length}
                  itemSize={getSize}
                  overscanCount={4}
                  itemKey={(index: number) => messages[index].message_id}
                >
                  {Row}
                </VariableSizeList>
              )}
            </AutoSizer>
          )}
        </Paper>

        {/* ────── 입력/요약 컨트롤 (1 줄) ────── */}
        <Box
          sx={{
            flex: "0 0 auto",   // 고정 높이
            display: "flex",
            gap: 1,
            alignItems: "center",
          }}
        >

        {/* 모드 아이콘 토글 */}
        <ToggleButtonGroup
          color="primary"
          value={inputMode}
          exclusive
          onChange={(_, v) => v && setInputMode(v)}
          size="small"
        >
          <ToggleButton value="chat"   sx={{ px:1 }} aria-label="채팅">
            <ChatOutlinedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="summary" sx={{ px:1 }} aria-label="문서 요약">
            <ArticleOutlinedIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>

        {/* ───────── chat 모드 ───────── */}
        {inputMode === "chat" && (
          <>
            <FormControlLabel
              sx={{ mr: 1,
                '.MuiFormControlLabel-label': {
                  fontSize: 12,          // 더 작은 글꼴
                  width: 32,             // 셀 너비 확보 (필요하면 36·40 으로 조절)
                  textAlign: 'center',
                  letterSpacing: '0.03em'
                }
               }}
              control={
                <Switch
                  size="small"
                  checked={searchMode}
                  onChange={e => setSearchMode(e.target.checked)}
                />
              }
              label="검색"
            />

            <TextField
              fullWidth
              size="small"
              label="메시지 입력"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") send(); }}
            />

            <Button
              variant="contained"
              onClick={send}
              disabled={isLoading || !question.trim()}
            >
              Send
            </Button>

            <IconButton
              color={isRecording ? "error" : "primary"}
              onClick={recordAndSend}
              disabled={isLoading}
              sx={{ mr: 1 }}
            >
              <Mic />
            </IconButton>
          </>
        )}

        {/* ───────── summary 모드 ───────── */}
        {inputMode === "summary" && (
          <>
            <Button
              variant="outlined"
              component="label"
              size="small"
              disabled={isLoading}
            >
              파일
              <input
                hidden
                type="file"
                accept=".pdf,.txt"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
              />
            </Button>

            <Typography
              variant="body2"
              sx={{
                flex: 1,
                maxWidth: 240,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {uploadFile?.name || "선택된 파일 없음"}
            </Typography>

            <Button
              variant="contained"
              onClick={summarize}
              disabled={!uploadFile || isLoading}
            >
              요약
            </Button>
          </>
        )}
        </Box>
      </Box>

      {/* 빠른 일정 Dialog */}
      <Dialog open={openQuick} onClose={()=>setOpenQuick(false)}>
        <DialogTitle>빠른 일정 추가</DialogTitle>
        <DialogContent sx={{ display:"flex", flexDirection:"column", gap:2, mt:1 }}>
          <TextField label="제목" value={quickTitle} onChange={e=>setQuickTitle(e.target.value)} />
          <TextField type="date" label="날짜" InputLabelProps={{ shrink:true }} value={quickDate} onChange={e=>setQuickDate(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={()=>setOpenQuick(false)}>취소</Button>
          <Button variant="contained" onClick={async()=>{ await quickSave(); }} disabled={!quickTitle.trim()}>저장</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editCid} onClose={()=>setEditCid(null)}>           {/* ★ NEW */}
        <DialogTitle>대화 제목 변경</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth autoFocus
            value={editTitle}
            onChange={e=>setEditTitle(e.target.value)}
            label="새 제목"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={()=>setEditCid(null)}>취소</Button>
          <Button variant="contained" disabled={!editTitle.trim()}
            onClick={async()=>{
              if(editCid){ await renameConversation(editCid, editTitle.trim()); }
              setEditCid(null);
            }}
          >저장</Button>
        </DialogActions>
      </Dialog>

      {/* ─── 녹음 중 안내 ─── */}
      <Dialog open={isRecording} PaperProps={{ sx:{ textAlign:"center", p:3 } }}>
        <DialogTitle sx={{ pb:1 }}>🎤 음성 명령을 말씀하세요</DialogTitle>
        <DialogContent sx={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
          <Typography>남은 시간: <b>{recordLeft}</b>초</Typography>
          <LinearProgress
            variant="determinate"
            value={(5 - recordLeft) * 20}    // 0‥100 %
            sx={{ width:200, height:8, borderRadius:4 }}
          />
        </DialogContent>
      </Dialog>

      {/* 프로필 입력 다이얼로그 */}
      <ProfilingDialog
        open={openProfileDlg}
        onClose={()=>setOpenProfileDlg(false)}
        onSaved={()=>{ setProfileExists(true); setOpenProfileDlg(false); }}
      />

      <MuiDialog
        open={!!fullImgUrl}
        onClose={()=>{
          if(fullImgUrl){
            URL.revokeObjectURL(fullImgUrl);     // 메모리 해제
            setFullImgUrl(null);
          }
        }}
        PaperProps={{ sx:{ p:0, background:"transparent" } }}
      >
        {fullImgUrl && (
          <img
            src={fullImgUrl}
            style={{
              width:512, height:512,            // 고정 512 × 512
              objectFit:"contain",
              display:"block"
            }}
          />
        )}
      </MuiDialog>
    </Box>
  );
}
