import { createContext, FC, useContext, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { useRouter } from "next/router";
import { useLocalStorage } from "usehooks-ts";

// APIs
import * as auth from "pages/api/auth";
import { setToken } from "pages/api/httpClient";

export interface UserContextValue {
  isSignIn: boolean;
  username?: string;
  signIn(form: { username: string; password: string }): Promise<void>;
  signUp(form: { username: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
}

const UserContext = createContext<UserContextValue | any>(null);

export const UserProvider: FC = ({ children }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mutateAsync: signIn } = useMutation(auth.signIn);
  const { mutateAsync: signUp } = useMutation(auth.register);
  const { mutateAsync: signOut } = useMutation(auth.signOut);
  const [isSignIn, setIsSignIn] = useState(false);
  const [username, setUsername, removeUserName] = useLocalStorage<any>(
    "curr_username",
    ""
  );

  const values: UserContextValue = {
    isSignIn,
    username,
    async signIn({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) {
      await signIn(
        { username, password },
        {
          onSuccess() {
            setIsSignIn(true);
            setUsername(username);
            router.push(`/`);
          },
        }
      );
    },
    async signUp({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) {
      await signUp(
        { username, password },
        {
          onSuccess() {
            router.push(`/auth/login`);
          },
        }
      );
    },
    async signOut() {
      const callBack = () => {
        setIsSignIn(false);
        removeUserName();
        setToken();
        queryClient.clear();
        router.push(`/auth/login`);
      };

      try {
        await signOut({});
      } catch (error) {
        console.log(error);
      } finally {
        callBack();
      }
    },
  };

  return <UserContext.Provider value={values}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  return useContext<UserContextValue>(UserContext);
};
