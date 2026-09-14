import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Cookies from "js-cookie";
import * as yup from "yup";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";

import { useUser } from "@/contexts/auth/auth-context";
import { AuthLayout, TextLink } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const loginSchema = yup.object({
  username: yup
    .string()
    .trim()
    .required("Enter your email.")
    .email("Enter an email address, like name@example.com."),
  password: yup.string().required("Enter your password."),
});

type LoginForm = yup.InferType<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useUser();
  const [needSignIn, setNeedSignIn] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: yupResolver(loginSchema) });

  useEffect(() => {
    if (Cookies.get("act")) {
      router.replace("/prediction/prediction");
    } else {
      setNeedSignIn(true);
    }
  }, []);

  const onSubmit = async (form: LoginForm) => {
    try {
      await signIn(form);
    } catch {
      setError("root", {
        message:
          "That email and password don’t match an account. Check both, then try again.",
      });
    }
  };

  if (!needSignIn) {
    return null;
  }

  return (
    <AuthLayout
      title="Sign In to Explainable"
      description="Use the email and password you registered with."
      footer={
        <>
          Don’t have an account? <TextLink href="/auth/sign-up">Create One</TextLink>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup className="gap-5">
          <Field data-invalid={errors.username ? true : undefined}>
            <FieldLabel htmlFor="username">Email</FieldLabel>
            <Input
              id="username"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              aria-invalid={errors.username ? true : undefined}
              {...register("username")}
            />
            <FieldError errors={[errors.username]} />
          </Field>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          {errors.root && <FieldError>{errors.root.message}</FieldError>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? "Signing In…" : "Sign In"}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}

LoginPage.title = "Sign In";
