import { createTheme } from "@mui/material/styles";

/*
 * XAFe Exchange · thème Material Design 3.
 * Une couleur principale (vert), un accent (ambre, celui du logo), et les
 * conteneurs tonals de Material pour les icônes et les états.
 */
export const tones = {
  green: { bg: "#CDEFD9", fg: "#06331B" },
  amber: { bg: "#FFE3B5", fg: "#4A2E00" },
  red: { bg: "#F9DEDC", fg: "#7A1F17" },
  blue: { bg: "#DBEAFF", fg: "#0B3B78" },
  neutral: { bg: "#E6EAE6", fg: "#2C302E" },
} as const;
export type Tone = keyof typeof tones;

export const brand = {
  mtn: { bg: "#FFCC00", fg: "#1B1B1B" },
  om: { bg: "#FF7900", fg: "#FFFFFF" },
  usdt: { bg: "#26A17B", fg: "#FFFFFF" },
  xafe: { bg: "#0B6B3A", fg: "#FFFFFF" },
};

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0B6B3A", dark: "#06512B", light: "#3E8C62", contrastText: "#FFFFFF" },
    secondary: { main: "#C27A00", contrastText: "#FFFFFF" },
    error: { main: "#B3261E" },
    success: { main: "#0B6B3A" },
    background: { default: "#F4F7F4", paper: "#FFFFFF" },
    text: { primary: "#191C1A", secondary: "#5B615E" },
    divider: "#E3E7E3",
  },
  /* unité de rayon : 4 px ; les écrans écrivent borderRadius 2/3/4/6 → 8/12/16/24 px */
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: "Roboto, system-ui, sans-serif",
    h3: { fontSize: 40, fontWeight: 600, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" },
    h4: { fontSize: 30, fontWeight: 600, letterSpacing: -0.3, fontVariantNumeric: "tabular-nums" },
    h5: { fontSize: 22, fontWeight: 600 },
    h6: { fontSize: 20, fontWeight: 600 },
    subtitle1: { fontSize: 16, fontWeight: 500 },
    body1: { fontSize: 16 },
    body2: { fontSize: 14, color: "#5B615E" },
    caption: { fontSize: 12, color: "#5B615E", letterSpacing: 0.3 },
    button: { textTransform: "none", fontWeight: 600, fontSize: 16 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 100, minHeight: 52, paddingInline: 24 },
        sizeSmall: { minHeight: 40, paddingInline: 16, fontSize: 14 },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 10, height: 36, fontWeight: 500, fontSize: 14 } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 100,
          minHeight: 44,
          "&.Mui-selected": { backgroundColor: "#CDEFD9", color: "#06331B" },
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: { minWidth: 0, color: "#5B615E", "&.Mui-selected": { color: "#06331B" } },
        label: { fontSize: 12, fontWeight: 500, "&.Mui-selected": { fontSize: 12 } },
      },
    },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 16 } } },
  },
});
