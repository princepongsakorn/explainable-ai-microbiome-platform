import getConfig from "next/config";
import axios from "axios";

const { publicRuntimeConfig } = getConfig();

export const httpClient = axios.create({
  baseURL: `${publicRuntimeConfig.api}`,
  timeout: 180000, // 3 minutes
});