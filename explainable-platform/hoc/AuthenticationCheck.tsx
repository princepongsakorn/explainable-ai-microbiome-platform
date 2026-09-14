import { useRouter } from "next/router";
import { jwtDecode } from "jwt-decode";
import Cookies from "js-cookie";
import { ComponentType, useEffect, useState } from "react";

/** Where a visitor without a usable session belongs, or null to let them in. */
function redirectFor(accessToken?: string): string | null {
  if (!accessToken) return "/auth/login";
  try {
    const { exp } = jwtDecode<{ exp: number }>(accessToken);
    return Date.now() >= exp * 1000 ? "/403" : null;
  } catch {
    return "/auth/login";
  }
}

const AuthenticationCheck = <P extends object>(
  WrappedComponent: ComponentType<P>
) => {
  function Authenticated(props: P) {
    const router = useRouter();
    const [allowed, setAllowed] = useState(false);

    // Checked after mount (the cookie is not readable during the server
    // render) and again on every navigation, so an expired session is caught
    // on the next page rather than only on a full reload. Redirecting belongs
    // in an effect: calling the router while rendering is a side effect React
    // may repeat.
    useEffect(() => {
      const destination = redirectFor(Cookies.get("act"));
      if (destination) {
        setAllowed(false);
        router.replace(destination);
      } else {
        setAllowed(true);
      }
    }, [router.asPath]);

    return allowed ? <WrappedComponent {...props} /> : null;
  }

  return Authenticated;
};

export default AuthenticationCheck;
