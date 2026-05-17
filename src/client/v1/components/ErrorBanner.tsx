interface ErrorBannerProps {
  message: string | null;
}

/** Displays the latest request error without interrupting the current UI state. */
export const ErrorBanner = ({ message }: ErrorBannerProps) => {
  return message ? <div className='error'>{message}</div> : null;
};
