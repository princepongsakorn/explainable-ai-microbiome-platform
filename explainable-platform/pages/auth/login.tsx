import { useUser } from "@/contexts/auth/auth-context";
import { Logo } from "../../components/common/Logo";
import { useRouter } from "next/router";

import * as yup from "yup";
import { AxiosError } from "axios";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import { dialogError } from "@/lib/dialog";
import { MainButton } from "@/components/ui/Button/button";

const loginValidateSchema = yup.object({
  username: yup.string().required("Required"),
  password: yup.string().required("Required"),
});

interface LoginForm {
  username: string;
  password: string;
}

export default function App() {
  const router = useRouter();
  const { signIn } = useUser();
  const [needSignIn, setNeedSignIn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const token = Cookies.get("act");
    if (token) {
      router.push("/prediction/prediction");
    } else {
      setNeedSignIn(true);
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: yupResolver(loginValidateSchema) });

  const onSubmit = async (form: LoginForm) => {
    try {
      setIsLoading(true);
      await signIn(form);
    } catch (error) {
      await dialogError(
        "Invalid email or password",
        "The email or password you entered is incorrect. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!needSignIn) {
    return null;
  }

  return (
    <div className="flex items-center h-screen w-full">
      <div className="flex flex-rows h-full w-full ">
        <div className="flex w-3/5 bg-white">
          <img
            className="w-full h-full object-cover"
            src={"/assets/login-bg.png"}
          />
          <div>
            <div className="flex flex-rows absolute left-0 top-0 ml-4 mt-4 items-center gap-2">
              <Logo />
              <div className="text-black">Explainable</div>
            </div>
          </div>
        </div>
        <div className="flex w-2/5 justify-center items-center">
          <form className="w-3/4" onSubmit={handleSubmit(onSubmit)}>
            <div className="mb-8 text-xl font-medium mb-4 text-center">
              Sign in to explainable-platform
            </div>
            <div className="mb-5">
              <input
                type="email"
                id="email"
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                placeholder="Email"
                {...register("username")}
                required
              />
            </div>
            <div className="mb-5">
              <input
                type="password"
                id="password"
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                placeholder="Password"
                {...register("password")}
                required
              />
            </div>
            <MainButton className="w-full" type="submit" loading={isLoading}>
              Sign in
            </MainButton>
            <div className="mt-6 pt-6 border-t border-gray-300">
              <div className="flex flex-row gap-1 justify-center">
                <div className="text-gray-500">Don't have an account?</div>
                <div
                  className="text-blue-700 cursor-pointer font-semibold hover:text-blue-800"
                  onClick={() => router.push("sign-up")}
                >
                  Sign up
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
