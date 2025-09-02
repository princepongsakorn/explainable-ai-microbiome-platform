// Third-party
import { AxiosError } from "axios";

// API
import { setToken, httpClient } from "pages/api/httpClient";

interface Token {
  access_token: string;
}

interface ISignIn {
  username: string;
  password: string;
}

interface ErrorResponse {
  code: string;
  message: string;
}

export const register = async (form: ISignIn): Promise<Token> => {
  try {
    const response = await httpClient.post(
      "/auth/register",
      form
    );
    console.log('response', response)

    return response.data;
  } catch (error) {
    const e = error as AxiosError<{ code: string; message: string }>;
    throw e;
  }
};

export const signIn = async (form: ISignIn): Promise<Token> => {
  try {
    const response = await httpClient.post<Token>(
      "/auth/login",
      form
    );

    const { access_token } = response.data;
    setToken(access_token);

    return response.data;
  } catch (error) {
    const e = error as AxiosError<{ code: string; message: string }>;
    throw e;
  }
};

export const signOut = async (_: any): Promise<void> => {
  try {
    await httpClient.post("/auth/logout");
  } catch (error) {
    const e = error as AxiosError<ErrorResponse>;
    throw e;
  }
};
