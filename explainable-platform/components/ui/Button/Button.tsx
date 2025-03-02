import { ButtonHTMLAttributes } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  type?: "submit" | "reset" | "button";
  loading?: boolean;
}

export const MainButton = ({
  children,
  className,
  loading = false,
  ...props
}: ButtonProps) => {
  return (
    <button
      type="submit"
      disabled={loading}
      className={`text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center ${
        loading ? "flex cursor-progress justify-center" : ""
      } ${className}`}
    >
      {loading ? <ArrowPathIcon className="animate-spin w-5" /> : children}
    </button>
  );
};
