import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

// The app has one, light theme. Sonner's default follows the OS, which would
// put dark toasts on a light page. Its stylesheet also sets a system font
// stack on the toaster; inherit the app's font instead.
const Toaster = ({ style, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      style={{ fontFamily: "inherit", ...style }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
