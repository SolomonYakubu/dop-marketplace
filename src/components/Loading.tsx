"use client";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({
  size = "md",
  className = "",
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div
      className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 ${sizeClasses[size]} ${className}`}
    />
  );
}

interface LoadingSkeletonProps {
  className?: string;
}

export function LoadingSkeleton({ className = "" }: LoadingSkeletonProps) {
  return <div className={`animate-pulse bg-gray-800 rounded ${className}`} />;
}

interface LoadingCardProps {
  showImage?: boolean;
}

export function LoadingCard({ showImage = false }: LoadingCardProps) {
  return (
    <div className="container-panel p-6 animate-pulse">
      <div className="flex gap-4">
        {showImage && <LoadingSkeleton className="w-20 h-20 flex-shrink-0" />}
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <LoadingSkeleton className="h-4 w-16" />
            <LoadingSkeleton className="h-4 w-20" />
          </div>
          <LoadingSkeleton className="h-6 w-3/4" />
          <LoadingSkeleton className="h-4 w-full" />
          <LoadingSkeleton className="h-4 w-2/3" />
          <div className="flex justify-between items-center pt-2">
            <div className="flex gap-2">
              <LoadingSkeleton className="h-5 w-12" />
              <LoadingSkeleton className="h-5 w-16" />
            </div>
            <LoadingSkeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface LoadingButtonProps {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
}

export function LoadingButton({
  children,
  loading = false,
  disabled = false,
  onClick,
  className = "",
  type = "button",
}: LoadingButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      className={`flex items-center justify-center gap-2 transition-opacity ${
        loading || disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${className}`}
    >
      {loading && <LoadingSpinner size="sm" />}
      {children}
    </button>
  );
}
