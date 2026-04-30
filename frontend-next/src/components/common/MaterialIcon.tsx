import {
  AlarmClockCheck,
  Armchair,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  Brain,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleHelp,
  Clock3,
  Flag,
  GraduationCap,
  History,
  Image,
  Landmark,
  Link2Off,
  ListChecks,
  Lock,
  Mail,
  Moon,
  MoonStar,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Sun,
  Sunrise,
  Target,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react';

interface MaterialIconProps {
  icon: string;
  size?: number;
  color?: string;
  filled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const ICONS: Record<string, LucideIcon> = {
  account_balance: Landmark,
  add: Plus,
  alarm_on: AlarmClockCheck,
  arrow_back: ArrowLeft,
  arrow_forward: ArrowRight,
  auto_awesome: Sparkles,
  bar_chart: BarChart3,
  bedtime: Moon,
  calendar_month: CalendarDays,
  check: Check,
  check_circle: CircleCheck,
  checklist: ListChecks,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  close: X,
  dark_mode: Moon,
  delete: Trash2,
  event_available: CalendarCheck,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  flag: Flag,
  history: History,
  image: Image,
  insights: BarChart3,
  link_off: Link2Off,
  lock: Lock,
  lunch_dining: Utensils,
  mail: Mail,
  menu_book: GraduationCap,
  nights_stay: MoonStar,
  nightlife: MoonStar,
  notifications_active: BellRing,
  pending: Clock3,
  person: User,
  photo_camera: Camera,
  psychology: Brain,
  quiz: CircleHelp,
  radio_button_unchecked: Circle,
  refresh: RefreshCw,
  schedule: CalendarDays,
  school: GraduationCap,
  send: Send,
  share: Share2,
  smart_toy: Bot,
  today: CalendarDays,
  track_changes: Target,
  update: History,
  upload_file: Upload,
  warning: TriangleAlert,
  wb_sunny: Sun,
  wb_twilight: Sunrise,
  weekend: Armchair,
  work: BriefcaseBusiness,
};

export default function MaterialIcon({ icon, size = 24, color, filled = false, className = '', style }: MaterialIconProps) {
  const Icon = ICONS[icon] ?? Circle;

  return (
    <Icon
      aria-hidden="true"
      className={className}
      style={{
        color,
        display: 'inline-block',
        flexShrink: 0,
        verticalAlign: '-0.15em',
        ...style,
      }}
      width={size}
      height={size}
      strokeWidth={filled ? 2.35 : 2}
    />
  );
}
