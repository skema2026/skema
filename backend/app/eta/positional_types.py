from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple, Literal, TypedDict

WeekdayName = Literal[
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
]

DOW_TO_NAME: List[WeekdayName] = [
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
]

NAME_TO_DOW = {name: i for i, name in enumerate(DOW_TO_NAME)}


@dataclass
class GridModel:
    # Pixel bounds of seven weekday columns (x0, x1) per column, left<=x<right
    column_bounds: List[Tuple[int, int]]
    # Pixel Y positions of horizontal time grid lines, sorted ascending.
    # Should include half-hour lines if present (i.e., 2 per hour)
    row_bounds: List[int]
    # Calibration: what time does row_bounds[0] represent?
    # Everytime timetables: the first detected horizontal line is the 9:30 separator
    # (the header/border line at 9:00 is usually not detected by the line filter),
    # so row_bounds[0] = 9:30 line → start_minute=30.
    # Formula: time(idx) = start_hour*60 + start_minute + idx*minutes_per_step
    start_hour: int = 9
    start_minute: int = 30   # was 0; changed to 30 to fix systematic -30 min offset
    minutes_per_step: int = 30
    # Direct pixel calibration for (top_y - header_bottom) / pixels_per_slot calculation
    header_bottom: int = 0        # y-pixel where content grid starts (below day-header row)
    pixels_per_slot: float = 0.0  # pixels per 30-minute slot; 0 means not calibrated
    grid_origin_y: int = 0        # y-pixel corresponding to slot 0 (09:00); may be above header_bottom


@dataclass
class DetectedBlock:
    # Bounding box in pixels (x0,y0,x1,y1)
    bbox: Tuple[int, int, int, int]
    center_x: int
    top_y: int
    bottom_y: int
    ocr_text: str = ""


class NormalizedEntry(TypedDict):
    title: str
    day: WeekdayName
    startTime: str  # "HH:MM"
    endTime: str    # "HH:MM"
    location: str
    bbox: Tuple[int, int, int, int]
