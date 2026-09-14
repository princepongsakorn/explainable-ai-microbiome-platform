import * as yup from "yup";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";

import { useUser } from "@/contexts/auth/auth-context";
import { AuthLayout, TextLink } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { notifySuccess } from "@/lib/notify";

const signUpSchema = yup.object({
  username: yup
    .string()
    .trim()
    .required("Enter your email.")
    .email("Enter an email address, like name@example.com."),
  password: yup.string().required("Choose a password."),
});

type SignUpForm = yup.InferType<typeof signUpSchema>;

export default function SignUpPage() {
  const { signUp } = useUser();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpForm>({ resolver: yupResolver(signUpSchema) });

  const onSubmit = async (form: SignUpForm) => {
    try {
      // On success the auth context takes the visitor to the sign-in page.
      await signUp(form);
      notifySuccess(
        "Account Created",
        "Sign in with the email and password you just set."
      );
    } catch {
      setError("root", {
        message:
          "We couldn’t create your account. The email may already be registered: try signing in, or try again in a moment.",
      });
    }
  };

  return (
    <AuthLayout
      title="Create an Account"
      description="Register with your email to upload samples and review predictions."
      footer={
        <>
          Already have an account? <TextLink href="/auth/login">Sign In</TextLink>
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
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          {errors.root && <FieldError>{errors.root.message}</FieldError>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? "Creating Account…" : "Create Account"}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}

SignUpPage.title = "Create Account";
