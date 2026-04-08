import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { EventClickArg } from "@fullcalendar/core";
import { DateClickArg } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Divider
} from "@mui/material";
import { fetchWithAuth } from "../utils/api";

export default function CalendarPage() {
  const calRef = useRef<FullCalendar>(null);
  const [search] = useSearchParams();          // ?e=eventId 로 진입했을 때 포커스
  const [selected, setSelected] = useState<any|null>(null);
  const [editTitle, setEditTitle] = useState("");

  // -------- FullCalendar 이벤트 소스 ----------
  const fetchEvents = async (info: any, success: any) => {
    // 방법 A) UTC ISO 문자열 사용 (가장 간단)
    const start = info.start.toISOString();   // → 2025‑03‑29T23:00:00.000Z
    const end   = info.end  .toISOString();
  
    // 방법 B) encodeURIComponent(info.startStr) 도 OK
    const data = await fetchWithAuth(
      `/events?start=${start}&end=${end}`
    );
  
    success(
      (data as any[]).map((ev) => ({
        id:    ev.id,
        title: ev.summary,
        start: ev.start.dateTime ?? ev.start.date,
        end:   ev.end  .dateTime ?? ev.end .date,
      }))
    );
  };

  // -------- eventClick → 상세 보기 ----------
  const onEventClick = async (e:EventClickArg)=>{
    const ev = await fetchWithAuth(`/events/${e.event.id}`);
    setSelected(ev);
    setEditTitle(ev.summary);
  };

  // -------- dateClick → 새 일정 ----------
  const onDateClick = (arg:DateClickArg)=>{
    const start = dayjs(arg.date).hour(9).minute(0);
    setSelected({
      id:null,
      summary:"",
      start:{ dateTime:start.toISOString() },
      end  :{ dateTime:start.add(1,"hour").toISOString() }
    });
    setEditTitle("");
  };

  // -------- 저장 / 삭제 ----------
  const save = async ()=>{
    const body = {
      summary: editTitle,
      description:"",
      start: selected.start.dateTime,
      end:   selected.end.dateTime,
      timezone:"UTC"
    };
    if (selected.id) {               // 업데이트
      await fetchWithAuth(`/events/${selected.id}`,{method:"PUT",body:JSON.stringify(body)});
    } else {                         // 새로 생성
      await fetchWithAuth("/events", {method:"POST", body:JSON.stringify(body)});
    }
    setSelected(null);
    calRef.current?.getApi().refetchEvents();
  };
  const remove = async ()=>{
    if (!selected?.id) return;

    setSelected(null);

    try {
      await fetchWithAuth(`/events/${selected.id}`, { method: "DELETE" });
    } finally {
      calRef.current?.getApi().refetchEvents();
    }
  };

  // -------- 초기 진입 시 특정 이벤트 포커스 --------
  useEffect(()=>{
    const eid = search.get("e");
    if (!eid) return;
    (async()=>{
      const ev = await fetchWithAuth(`/events/${eid}`);
      setSelected(ev);
      setEditTitle(ev.summary);
    })();
  }, [search]);

  return (
    <Box sx={{p:2, width:"100%", height:"100%"}}>
      <Typography variant="h5" sx={{mb:2}}>내 캘린더</Typography>
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        height="calc(100vh - 120px)"
        events={fetchEvents}
        eventClick={onEventClick}
        dateClick={onDateClick}
      />

      {/* -------- 상세/편집 Dialog -------- */}
      <Dialog open={Boolean(selected)} onClose={()=>setSelected(null)} fullWidth>
        <DialogTitle>{selected?.id ? "일정 상세" : "새 일정"}</DialogTitle>
        {selected && (
          <>
            <DialogContent sx={{display:"flex",flexDirection:"column",gap:2,mt:1}}>
              <TextField label="제목" value={editTitle}
                         onChange={e=>setEditTitle(e.target.value)}/>
              <Typography variant="body2">
                {dayjs(selected.start.dateTime||selected.start.date).format("YYYY‑MM‑DD HH:mm")}
                {" – "}
                {dayjs(selected.end.dateTime||selected.end.date).format("YYYY‑MM‑DD HH:mm")}
              </Typography>
            </DialogContent>
            <DialogActions>
              {selected.id && (
                <Button color="error" onClick={remove}>삭제</Button>
              )}
              <Box sx={{flex:1}} />
              <Button onClick={()=>setSelected(null)}>닫기</Button>
              <Button variant="contained" onClick={save} disabled={!editTitle.trim()}>저장</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
