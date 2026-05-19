import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import Cookies from "js-cookie";
import { jwtDecode } from "jwt-decode";

// NEXT_PUBLIC_* env vars are inlined at build time and reach the browser without SSR.
// Defaults to "/api" so requests go through the nginx reverse proxy (same origin).
const API_BASE_URL = process.env.NEXT_PUBLIC_API ?? "/api";

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180000, // 3 minutes
});

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token && config.headers) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  return config;
});

export function getToken(): string | undefined {
  return Cookies.get("act");
}

export function setToken(token?: string): void {
  if (token) {
    const expiresAccessTokenAt = jwtDecode<{ exp: number }>(token).exp;
    Cookies.set("act", token, {
      expires: expiresAccessTokenAt,
      sameSite: "strict",
    });
  } else {
    Cookies.remove("rt");
    Cookies.remove("act");
  }
}
