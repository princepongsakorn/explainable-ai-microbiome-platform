import { useUser } from "@/contexts/auth/auth-context";
import { Logo } from "../../components/common/Logo";
import { useRouter } from "next/router";

import * as yup from "yup";
import { AxiosError } from "axios";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import { dialog, dialogError } from "@/lib/dialog";
import { MainButton } from "@/components/ui/Button/button";

const registorValidateSchema = yup.object({
  username: yup.string().required("Required"),
  password: yup.string().required("Required"),
});

interface RegistorForm {
  username: string;
  password: string;
}

export default function App() {
  const router = useRouter();
  const { signUp } = useUser();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistorForm>({ resolver: yupResolver(registorValidateSchema) });

  const onSubmit = async (form: RegistorForm) => {
    try {
      setIsLoading(true);
      await signUp(form);
      await dialog(
        "Your account has been successfully created!",
        "Your registration is complete. You can now log in and start using our services."
      );
      router.replace("login");
    } catch (error) {
      await dialogError(
        "Registration unsuccessful.",
        "We encountered an issue while creating your account. Please try again later."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center h-screen w-full">
      <div className="flex flex-rows h-full w-full ">
        <div className="flex w-3/5 bg-black">
          <img
            className="w-full h-full object-cover"
            src={"/assets/login-bg.png"}
          />
          <div>
            <div className="flex flex-rows absolute left-0 top-0 ml-4 mt-4 items-center gap-2">
              <Logo />
              <div className="text-white">Explainable</div>
            </div>
          </div>
        </div>
        <div className="flex w-2/5 justify-center items-center">
          <form className="w-3/4" onSubmit={handleSubmit(onSubmit)}>
            <div className="mb-8 text-xl font-medium mb-4 text-center">
              Create an account
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
              Create account
            </MainButton>
            <div className="mt-6 pt-6 border-t border-gray-300">
              <div className="flex flex-row gap-1 justify-center">
                <div className="text-gray-500">Already have an account?</div>
                <div
                  className="text-blue-700 cursor-pointer font-semibold hover:text-blue-800"
                  onClick={() => router.push("login")}
                >
                  Sign in
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
