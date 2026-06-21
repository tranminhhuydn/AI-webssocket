from PIL import Image
import os

input_image = "icon.png"

sizes = [16, 48, 128]

img = Image.open(input_image)

for size in sizes:
    resized = img.resize((size, size), Image.LANCZOS)

    output_file = f"icon{size}.png"
    resized.save(output_file)

    print(f"Đã lưu: {output_file}")

# muốn tạo luôn file .ico cho Chrome Extension:
# from PIL import Image

# img = Image.open("icon.png")

# img.save(
#     "icon.ico",
#     format="ICO",
#     sizes=[(16,16), (48,48), (128,128)]
# )

# print("Đã tạo icon.ico")