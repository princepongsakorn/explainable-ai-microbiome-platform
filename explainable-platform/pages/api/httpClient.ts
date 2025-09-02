import getConfig from "next/config";
import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import Cookies from "js-cookie";
import { jwtDecode } from "jwt-decode";

const { publicRuntimeConfig } = getConfig();

export const httpClient = axios.create({
  baseURL: `${publicRuntimeConfig.api}`,
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
