from setuptools import setup, find_packages

setup(
    name="mlflow_shap",
    version="0.1.0",
    author="Your Name",
    author_email="your_email@example.com",
    description="A library for saving and loading SHAP explainers with MLflow",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/mlflow_shap",
    packages=find_packages(),
    install_requires=[
        "mlflow",
        "shap",
        "joblib"
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires='>=3.6',
)